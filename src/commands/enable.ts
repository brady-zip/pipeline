import { execSync } from "child_process";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph } from "../lib/graph.js";
import { modifyWorkflows } from "../lib/modifier.js";
import { detectPRContext } from "../lib/detector.js";
import { parseJobKey } from "../types.js";

export const enableCommand = new Command("enable")
  .description("Enable jobs and dependencies, disable others")
  .argument("<jobs...>", "Jobs to enable (workflow:job format)")
  .option("--keep-labels", "Preserve label-based conditions")
  .action(async (jobs: string[], options: { keepLabels?: boolean }) => {
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

    await modifyWorkflows(workflows, enabledJobs, {
      keepLabels: options.keepLabels,
    });

    const needsPRContext = detectPRContext(workflows, enabledJobs);

    // Output
    const enabledList = Array.from(enabledJobs).sort().join(", ");
    console.log(`✓ Enabled ${enabledJobs.size} jobs: ${enabledList}`);
    console.log(`✓ Disabled ${disabledJobs.size} jobs`);
    console.log("");

    // Get unique workflows with enabled jobs
    const workflowsToRun = new Set<string>();
    for (const job of enabledJobs) {
      const { workflow } = parseJobKey(job);
      workflowsToRun.add(workflow);
    }

    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();
    const testBranch = `${currentBranch}-test-ci`;

    const jobList = Array.from(enabledJobs).sort().join(", ");
    const commitMsg = `### DO NOT MERGE

Test CI for jobs: ${jobList}

Created by \`pipeline enable\` from [${currentBranch}](../tree/${currentBranch})`;

    console.log("To test:");
    console.log(`  git checkout -b ${testBranch}`);
    console.log("  git add .github/");
    console.log(
      `  git commit -m $'${commitMsg.replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`,
    );
    console.log("  git push -u origin HEAD");

    if (needsPRContext) {
      console.log(
        "  REPO_ID=$(git remote get-url origin | sed 's/.*github.com[:\\/]\\(.*\\).git/\\1/')",
      );
      console.log("  gh pr create --fill --repo $REPO_ID");
    } else {
      const workflowFile = Array.from(workflowsToRun)[0] + ".yml";
      console.log(
        `  gh workflow run ${workflowFile} && sleep 2 && gh run watch $(gh run list --workflow=${workflowFile} --limit 1 --json databaseId -q '.[0].databaseId') && osascript -e 'display notification "Workflow complete" with title "pipeline"'`,
      );
    }
  });
