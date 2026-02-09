import { execSync } from "child_process";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph } from "../lib/graph.js";
import { modifyWorkflows } from "../lib/modifier.js";
import { detectPRContext } from "../lib/detector.js";
import { parseJobKey } from "../types.js";

const TEST_BRANCH_SUFFIX = "-test-ci";
const ENABLE_COMMIT_MARKER = "### DO NOT MERGE";

function detectBranchState(currentBranch: string): {
  isTestBranch: boolean;
  parentBranch: string;
  testBranch: string;
} {
  const isTestBranch = currentBranch.endsWith(TEST_BRANCH_SUFFIX);
  if (isTestBranch) {
    return {
      isTestBranch: true,
      parentBranch: currentBranch.slice(0, -TEST_BRANCH_SUFFIX.length),
      testBranch: currentBranch,
    };
  }
  return {
    isTestBranch: false,
    parentBranch: currentBranch,
    testBranch: `${currentBranch}${TEST_BRANCH_SUFFIX}`,
  };
}

function findInstrumentedCommit(): string | null {
  const log = execSync(`git log --oneline --format="%H %s" -n 50`, {
    encoding: "utf-8",
  });

  for (const line of log.split("\n")) {
    const [hash] = line.split(" ", 1);
    if (!hash) continue;

    const msg = execSync(`git log -1 --format=%B ${hash}`, {
      encoding: "utf-8",
    });
    if (msg.startsWith(ENABLE_COMMIT_MARKER)) {
      return hash;
    }
  }
  return null;
}

function hoistInstrumentedCommit(commitHash: string): void {
  // Check for merge commits between HEAD and the instrumented commit
  const mergeCheck = execSync(
    `git log --merges ${commitHash}..HEAD --oneline`,
    { encoding: "utf-8" },
  ).trim();

  if (mergeCheck) {
    console.error(
      "Error: Merge commits found between instrumented commit and HEAD.",
    );
    console.error(
      "       Run 'pipeline disable' first, resolve conflicts, then re-enable.",
    );
    process.exit(1);
  }

  // Reorder commits: move instrumented commit to top
  execSync(
    `git rebase --onto ${commitHash}^ ${commitHash} HEAD && git cherry-pick ${commitHash}`,
    { encoding: "utf-8", stdio: "inherit" },
  );
}

function hasNonInstrumentedChanges(
  parentBranch: string,
  instrumentedCommit: string,
): boolean {
  const mergeBase = execSync(`git merge-base ${parentBranch} HEAD`, {
    encoding: "utf-8",
  }).trim();

  // Count commits between merge-base and the commit before the instrumented one
  const count = execSync(
    `git rev-list --count ${mergeBase}..${instrumentedCommit}^`,
    { encoding: "utf-8" },
  ).trim();

  return parseInt(count, 10) > 0;
}

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

    const branchState = detectBranchState(currentBranch);

    // Handle re-enable on test branch: hoist instrumented commit if needed
    let instrumentedCommit: string | null = null;
    if (branchState.isTestBranch) {
      instrumentedCommit = findInstrumentedCommit();

      if (instrumentedCommit) {
        const headHash = execSync("git rev-parse HEAD", {
          encoding: "utf-8",
        }).trim();

        if (instrumentedCommit !== headHash) {
          console.log("Hoisting instrumented commit to HEAD...");
          hoistInstrumentedCommit(instrumentedCommit);
          // Update instrumentedCommit to new HEAD after hoisting
          instrumentedCommit = execSync("git rev-parse HEAD", {
            encoding: "utf-8",
          }).trim();
        }
      }
    }

    const jobList = Array.from(enabledJobs).sort().join(", ");
    const commitMsg = `### DO NOT MERGE

Test CI for jobs: ${jobList}

Created by \`pipeline enable\` from [${branchState.parentBranch}](../tree/${branchState.parentBranch})`;
    const escapedCommitMsg = commitMsg
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n");

    console.log("To test:");
    if (branchState.isTestBranch) {
      // Re-enable mode: amend existing commit
      console.log("  git add .github/");
      console.log(`  git commit --amend -m $'${escapedCommitMsg}'`);
      console.log("  git push --force-with-lease");
    } else {
      // New branch mode
      console.log(`  git checkout -b ${branchState.testBranch}`);
      console.log("  git add .github/");
      console.log(`  git commit -m $'${escapedCommitMsg}'`);
      console.log("  git push -u origin HEAD");
    }

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

    if (branchState.isTestBranch && instrumentedCommit) {
      const hasChanges = hasNonInstrumentedChanges(
        branchState.parentBranch,
        instrumentedCommit,
      );

      if (hasChanges) {
        // Squash non-instrumented changes back to parent, excluding .github/
        console.log(
          `  git checkout ${branchState.parentBranch} && ` +
            `git merge --squash ${branchState.testBranch} && ` +
            `git reset HEAD -- .github/ && ` +
            `git checkout -- .github/ && ` +
            `git commit -m "changes from ${branchState.testBranch}" && ` +
            `git branch -D ${branchState.testBranch} && ` +
            `git push origin --delete ${branchState.testBranch}`,
        );
      } else {
        // No changes to squash, just delete
        console.log(
          `  git checkout ${branchState.parentBranch} && ` +
            `git branch -D ${branchState.testBranch} && ` +
            `git push origin --delete ${branchState.testBranch}`,
        );
      }
    } else {
      // New branch flow - simple cleanup
      console.log(
        `  git checkout ${branchState.parentBranch} && git branch -D ${branchState.testBranch} && git push origin --delete ${branchState.testBranch}`,
      );
    }
  });
