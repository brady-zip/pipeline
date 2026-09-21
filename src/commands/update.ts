import { $ } from "bun";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph, getCalledWorkflows } from "../lib/graph.js";
import { modifyWorkflows, printModifyResult } from "../lib/modifier.js";
import { detectPRContext } from "../lib/detector.js";
import { collectWarnings, printWarnings } from "../lib/warnings.js";
import {
  DEFAULT_PR_LABEL,
  dispatchLines,
  effectivePRLabels,
  prCreateLines,
} from "../lib/instructions.js";
import { parseJobKey } from "../types.js";
import {
  TEST_BRANCH_SUFFIX,
  detectBranchState,
  findInstrumentedCommit,
  getInstrumentedJobs,
  hoistInstrumentedCommit,
} from "../lib/branch.js";

interface UpdateOptions {
  keepLabels?: boolean;
  prLabel?: string[];
  /** False when `--no-run-ci-label` was passed. */
  runCiLabel?: boolean;
}

export const updateCommand = new Command("update")
  .description("Update instrumentation after rebase")
  .option("--keep-labels", "Preserve label-based conditions")
  .option(
    "--pr-label <labels...>",
    `Extra labels to put on the test PR (on top of ${DEFAULT_PR_LABEL})`,
  )
  .option(
    "--no-run-ci-label",
    `Do not add the default ${DEFAULT_PR_LABEL} label to the test PR`,
  )
  .action(async (options: UpdateOptions) => {
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
    let instrumentedCommit = await findInstrumentedCommit();

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

    console.log(`Found instrumented jobs: ${jobs.join(", ")}`);

    // Hoist instrumented commit to HEAD if needed
    const headHash = (await $`git rev-parse HEAD`.text()).trim();

    if (instrumentedCommit !== headHash) {
      console.log("Hoisting instrumented commit to HEAD...");
      await hoistInstrumentedCommit(instrumentedCommit, currentBranch);
      instrumentedCommit = (await $`git rev-parse HEAD`.text()).trim();
    }

    // Parse workflows and build graph
    const workflows = await parseWorkflows();
    const graph = buildDependencyGraph(workflows);

    // Validate all target jobs still exist
    for (const job of jobs) {
      if (!graph.jobs.has(job)) {
        console.error(`Error: Job "${job}" no longer exists in workflows.`);
        process.exit(1);
      }
    }

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
    const allJobs = new Set(graph.jobs.keys());
    const disabledJobs = new Set(
      [...allJobs].filter((j) => !enabledJobs.has(j)),
    );

    const calledWorkflows = getCalledWorkflows(graph, enabledJobs);

    const modifyResult = await modifyWorkflows(workflows, enabledJobs, {
      keepLabels: options.keepLabels,
      calledWorkflows,
    });

    const needsPRContext = detectPRContext(
      workflows,
      enabledJobs,
      calledWorkflows,
    );

    const warnings = await collectWarnings({
      workflows,
      graph,
      enabledJobs,
      calledWorkflows,
      modifyResult,
      prLabels: effectivePRLabels({
        prLabels: options.prLabel,
        includeDefaultLabel: options.runCiLabel,
      }),
    });

    // Output
    const enabledList = Array.from(enabledJobs).sort().join(", ");
    console.log(`✓ Enabled ${enabledJobs.size} jobs: ${enabledList}`);
    console.log(`✓ Disabled ${disabledJobs.size} jobs`);
    console.log("");
    printModifyResult(modifyResult);
    printWarnings(warnings);

    // Get unique workflows with enabled jobs
    const workflowsToRun = new Set<string>();
    for (const job of enabledJobs) {
      const { workflow } = parseJobKey(job);
      workflowsToRun.add(workflow);
    }

    const jobList = Array.from(enabledJobs).sort().join(", ");
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
    console.log("To cleanup:");
    console.log("  pipeline cleanup");
  });
