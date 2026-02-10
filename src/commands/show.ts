import { execSync } from "child_process";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph } from "../lib/graph.js";
import { detectPRContext } from "../lib/detector.js";
import { parseJobKey } from "../types.js";
import {
  TEST_BRANCH_SUFFIX,
  detectBranchState,
  findInstrumentedCommit,
  getInstrumentedJobs,
} from "../lib/branch.js";

export const showCommand = new Command("show")
  .description("Show test and cleanup steps for current instrumentation")
  .action(async () => {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();

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
    const instrumentedCommit = findInstrumentedCommit();

    if (!instrumentedCommit) {
      console.error("Error: No instrumented commit found.");
      console.error("       Use 'pipeline enable' to create instrumentation.");
      process.exit(1);
    }

    // Parse jobs from the instrumented commit
    const jobs = getInstrumentedJobs(instrumentedCommit);

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

    const needsPRContext = detectPRContext(workflows, enabledJobs);

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
    console.log(`  git commit --amend -m $'${escapedCommitMsg}'`);
    console.log("  git push --force-with-lease");

    if (needsPRContext) {
      console.log(
        "  REPO_ID=$(git remote get-url origin | sed 's/.*github.com[:\\/]\\(.*\\).git/\\1/')",
      );
      console.log("  gh pr create --fill --repo $REPO_ID");
    } else {
      const workflowFile = Array.from(workflowsToRun)[0] + ".yml";
      console.log(
        `  gh workflow run ${workflowFile} --ref ${branchState.testBranch} && sleep 2 && gh run watch $(gh run list --workflow=${workflowFile} --limit 1 --json databaseId -q '.[0].databaseId') && osascript -e 'display notification "Workflow complete" with title "pipeline"'`,
      );
    }

    console.log("");
    console.log("To cleanup:");
    console.log("  pipeline cleanup");
  });
