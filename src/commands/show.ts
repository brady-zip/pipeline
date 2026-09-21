import { $ } from "bun";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph, getCalledWorkflows } from "../lib/graph.js";
import { detectPRContext } from "../lib/detector.js";
import {
  DEFAULT_PR_LABEL,
  dispatchLines,
  prCreateLines,
} from "../lib/instructions.js";
import { parseJobKey } from "../types.js";
import {
  TEST_BRANCH_SUFFIX,
  detectBranchState,
  findInstrumentedCommit,
  getInstrumentedJobs,
} from "../lib/branch.js";

export const showCommand = new Command("show")
  .description("Show test and cleanup steps for current instrumentation")
  .option(
    "--pr-label <labels...>",
    `Extra labels to put on the test PR (on top of ${DEFAULT_PR_LABEL})`,
  )
  .option(
    "--no-run-ci-label",
    `Do not add the default ${DEFAULT_PR_LABEL} label to the test PR`,
  )
  .action(async (options: { prLabel?: string[]; runCiLabel?: boolean }) => {
    const currentBranch = (
      await $`git rev-parse --abbrev-ref HEAD`.text()
    ).trim();

    // Must be on a test branch
    if (!currentBranch.endsWith(TEST_BRANCH_SUFFIX)) {
      console.error("Error: Not on a test branch.");
      console.error(
        "       Use 'pipeline enable' to create a new test branch.",
      );
      process.exit(1);
    }

    const branchState = detectBranchState(currentBranch);

    // Find instrumented commit
    const instrumentedCommit = await findInstrumentedCommit();

    if (!instrumentedCommit) {
      console.error("Error: No instrumented commit found.");
      console.error("       Use 'pipeline enable' to create instrumentation.");
      process.exit(1);
    }

    // Parse jobs from the instrumented commit
    const jobs = await getInstrumentedJobs(instrumentedCommit);

    if (jobs.length === 0) {
      console.error("Error: Could not parse jobs from instrumented commit.");
      process.exit(1);
    }

    // Parse workflows and build graph
    const workflows = await parseWorkflows();
    const graph = buildDependencyGraph(workflows);

    let enabledJobs: Set<string>;
    try {
      enabledJobs = graph.getRequiredJobs(jobs);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Circular dependency")) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }

    const calledWorkflows = getCalledWorkflows(graph, enabledJobs);
    const needsPRContext = detectPRContext(
      workflows,
      enabledJobs,
      calledWorkflows,
    );

    // Get unique workflows with enabled jobs
    const workflowsToRun = new Set<string>();
    for (const job of enabledJobs) {
      const { workflow } = parseJobKey(job);
      workflowsToRun.add(workflow);
    }

    const jobList = Array.from(enabledJobs).sort().join(", ");
    console.log(`Instrumented jobs: ${jobList}`);
    console.log("");

    const commitMsg = `### DO NOT MERGE

Test CI for jobs: ${jobList}

Created by \`pipeline enable\` from [${branchState.parentBranch}](../tree/${branchState.parentBranch})`;
    const escapedCommitMsg = commitMsg
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n");

    console.log("To test:");
    console.log("  git add .github/");
    console.log(`  git commit --amend -m $'${escapedCommitMsg}' -n`);
    console.log("  git push --force-with-lease");

    if (needsPRContext) {
      const [repoId, ...rest] = prCreateLines({
        prLabels: options.prLabel,
        includeDefaultLabel: options.runCiLabel,
      });
      console.log(repoId);
      console.log("  gh pr close HEAD --repo $REPO_ID 2>/dev/null || true");
      for (const line of rest) console.log(line);
    } else {
      for (const line of dispatchLines(
        workflowsToRun,
        calledWorkflows,
        branchState.testBranch,
      ))
        console.log(line);
    }

    console.log("");
    console.log("To sync changes from parent branch:");
    console.log("  pipeline disable");
    console.log(`  git rebase ${branchState.parentBranch}`);
    console.log("  pipeline update");

    console.log("");
    console.log("To cleanup:");
    console.log("  pipeline cleanup");
  });
