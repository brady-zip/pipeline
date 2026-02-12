import { $ } from "bun";
import { Command } from "commander";
import {
  TEST_BRANCH_SUFFIX,
  detectBranchState,
  findInstrumentedCommit,
  getInstrumentedJobs,
} from "../lib/branch.js";

export const cleanupCommand = new Command("cleanup")
  .description("Cleanup test branch and squash changes back to parent")
  .option("--branch <branch>", "Specify the test branch to clean up")
  .action(async (options: { branch?: string }) => {
    const currentBranch = (
      await $`git rev-parse --abbrev-ref HEAD`.text()
    ).trim();

    let testBranch: string;

    if (options.branch) {
      testBranch = options.branch;
    } else if (currentBranch.endsWith(TEST_BRANCH_SUFFIX)) {
      testBranch = currentBranch;
    } else {
      // Try to find the test branch for the current branch
      const candidateBranch = `${currentBranch}${TEST_BRANCH_SUFFIX}`;
      const branchExists = (
        await $`git branch --list ${candidateBranch}`.text()
      ).trim();

      if (!branchExists) {
        console.error("Error: Not on a test branch.");
        console.error(
          `       No local branch "${candidateBranch}" found either.`,
        );
        console.error(
          "       Use --branch to specify the test branch explicitly.",
        );
        process.exit(1);
      }

      testBranch = candidateBranch;
    }

    // Switch to the test branch if not already on it
    if (currentBranch !== testBranch) {
      console.log(`Switching to ${testBranch}...`);
      await $`git checkout ${testBranch}`;
    }

    const branchState = detectBranchState(testBranch);

    // Find instrumented commit
    const instrumentedCommit = await findInstrumentedCommit();

    if (!instrumentedCommit) {
      console.error("Error: No instrumented commit found.");
      process.exit(1);
    }

    // Check if instrumented commit is at HEAD
    const headHash = (await $`git rev-parse HEAD`.text()).trim();

    if (instrumentedCommit !== headHash) {
      console.error("Error: Instrumented commit is not at HEAD.");
      console.error("       Run 'pipeline update' to hoist it to HEAD first,");
      console.error("       or 'pipeline disable' to remove it.");
      process.exit(1);
    }

    // Check for uncommitted changes
    const status = (await $`git status --porcelain`.text()).trim();

    if (status) {
      console.error("Error: Uncommitted changes detected.");
      console.error("       Commit or stash changes before cleanup.");
      process.exit(1);
    }

    // Get the jobs for the commit message
    const jobs = await getInstrumentedJobs(instrumentedCommit);
    const jobList = jobs.length > 0 ? jobs.join(", ") : "unknown";

    console.log(`Cleaning up test branch: ${branchState.testBranch}`);
    console.log(`Parent branch: ${branchState.parentBranch}`);
    console.log("");

    // Checkout parent branch
    console.log(`Checking out ${branchState.parentBranch}...`);
    await $`git checkout ${branchState.parentBranch}`;

    // Check if there are any changes to squash (compare trees excluding .github)
    // Get the diff between parent and test branch, excluding .github/
    const diff = (
      await $`git diff ${branchState.parentBranch}...${branchState.testBranch} -- . ':!.github/'`.text()
    ).trim();

    if (!diff) {
      console.log("No changes to merge (only .github/ was modified).");
      console.log("");

      // Just delete the branch
      console.log(`Deleting local branch ${branchState.testBranch}...`);
      await $`git branch -D ${branchState.testBranch}`;

      // Try to delete remote branch
      const result =
        await $`git push origin --delete ${branchState.testBranch}`.nothrow();
      if (result.exitCode !== 0) {
        console.log("Remote branch not found or already deleted.");
      }

      console.log("");
      console.log("✓ Cleanup complete (no changes to merge)");
      return;
    }

    // Squash merge the test branch
    console.log("Squash merging changes...");
    await $`git merge --squash ${branchState.testBranch}`;

    // Reset .github/ changes (we don't want the instrumentation)
    console.log("Excluding .github/ changes...");
    const resetResult = await $`git reset HEAD -- .github/`.nothrow();
    if (resetResult.exitCode === 0) {
      await $`git checkout -- .github/`.nothrow();
    }

    // Check if there are still changes to commit
    const stagedChanges = (
      await $`git diff --cached --name-only`.text()
    ).trim();

    if (!stagedChanges) {
      console.log("No non-.github/ changes to commit.");
      await $`git reset --hard HEAD`;
    } else {
      // Commit the squashed changes
      const commitMsg = `Changes from ${branchState.testBranch}

Squashed from test branch (jobs: ${jobList})`;

      await $`git commit -m ${commitMsg}`;
      console.log("✓ Changes committed");
    }

    console.log("");

    // Delete local test branch
    console.log(`Deleting local branch ${branchState.testBranch}...`);
    await $`git branch -D ${branchState.testBranch}`;

    // Try to delete remote branch
    const deleteResult =
      await $`git push origin --delete ${branchState.testBranch}`.nothrow();
    if (deleteResult.exitCode !== 0) {
      console.log("Remote branch not found or already deleted.");
    }

    console.log("");
    console.log("✓ Cleanup complete");
  });
