import { $ } from "bun";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph, getCalledWorkflows } from "../lib/graph.js";
import { modifyWorkflows, printModifyResult } from "../lib/modifier.js";
import { detectPRContext } from "../lib/detector.js";
import { collectWarnings, printWarnings } from "../lib/warnings.js";
import { dispatchLines, prCreateLines } from "../lib/instructions.js";
import { parseJobKey } from "../types.js";
import { TEST_BRANCH_SUFFIX, findInstrumentedCommit } from "../lib/branch.js";

export const enableCommand = new Command("enable")
  .description("Enable jobs and dependencies, create test branch")
  .argument("<jobs...>", "Jobs to enable (workflow:job format)")
  .option("--keep-labels", "Preserve label-based conditions")
  .option(
    "--pr-label <labels...>",
    "Labels to put on the test PR (e.g. a repo's CI-opt-in label)",
  )
  .action(
    async (
      jobs: string[],
      options: { keepLabels?: boolean; prLabel?: string[] },
    ) => {
      // Validate job selectors format
      for (const job of jobs) {
        try {
          parseJobKey(job);
        } catch {
          console.error(
            `Error: Invalid job selector "${job}". Expected format: workflow:job`,
          );
          process.exit(1);
        }
      }

      const currentBranch = (
        await $`git rev-parse --abbrev-ref HEAD`.text()
      ).trim();

      // Block if already on a test branch
      if (currentBranch.endsWith(TEST_BRANCH_SUFFIX)) {
        console.error("Error: Already on a test branch.");
        console.error(
          "       Use 'pipeline update' to update instrumentation.",
        );
        process.exit(1);
      }

      // Check if already instrumented
      const testBranch = `${currentBranch}${TEST_BRANCH_SUFFIX}`;
      const instrumentedCommit = await findInstrumentedCommit();

      if (instrumentedCommit) {
        console.error("Error: Already instrumented.");
        console.error(
          "       Use 'pipeline update' to update or 'pipeline disable' to remove.",
        );
        process.exit(1);
      }

      const workflows = await parseWorkflows();
      const graph = buildDependencyGraph(workflows);

      // Validate all target jobs exist
      for (const job of jobs) {
        if (!graph.jobs.has(job)) {
          console.error(`Error: Job "${job}" not found`);
          const { workflow } = parseJobKey(job);
          const wf = workflows.get(workflow);
          if (!wf) {
            console.error(`  Workflow "${workflow}" does not exist`);
            const available = Array.from(workflows.keys()).join(", ");
            console.error(`  Available workflows: ${available}`);
          } else {
            const available = Array.from(wf.jobs.keys()).join(", ");
            console.error(`  Available jobs in ${workflow}: ${available}`);
          }
          process.exit(1);
        }
      }

      let enabledJobs: Set<string>;
      try {
        enabledJobs = graph.getRequiredJobs(jobs);
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("Circular dependency")
        ) {
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

Created by \`pipeline enable\` from [${currentBranch}](../tree/${currentBranch})`;
      const escapedCommitMsg = commitMsg
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n");

      console.log("To test:");
      console.log(`  git checkout -b ${testBranch}`);
      console.log("  git add .github/");
      console.log(`  git commit -m $'${escapedCommitMsg}' -n`);
      console.log("  git push -u origin HEAD");

      if (needsPRContext) {
        for (const line of prCreateLines(options.prLabel)) console.log(line);
      } else {
        for (const line of dispatchLines(
          workflowsToRun,
          calledWorkflows,
          testBranch,
        ))
          console.log(line);
      }

      console.log("");
      console.log("To cleanup:");
      console.log("  pipeline cleanup");
    },
  );
