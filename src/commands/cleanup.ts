import { execSync } from "child_process";
import { Command } from "commander";
import {
  TEST_BRANCH_SUFFIX,
  detectBranchState,
  findInstrumentedCommit,
  getInstrumentedJobs,
} from "../lib/branch.js";

export const cleanupCommand = new Command("cleanup")
  .description("Cleanup test branch and squash changes back to parent")
  .action(() => {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();

    // Must be on a test branch
    if (!currentBranch.endsWith(TEST_BRANCH_SUFFIX)) {
      console.error("Error: Not on a test branch.");
      process.exit(1);
    }

    const branchState = detectBranchState(currentBranch);

    // Find instrumented commit
    const instrumentedCommit = findInstrumentedCommit();

    if (!instrumentedCommit) {
      console.error("Error: No instrumented commit found.");
      process.exit(1);
    }

    // Check if instrumented commit is at HEAD
    const headHash = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
    }).trim();

    if (instrumentedCommit !== headHash) {
      console.error("Error: Instrumented commit is not at HEAD.");
      console.error("       Run 'pipeline update' to hoist it to HEAD first,");
      console.error("       or 'pipeline disable' to remove it.");
      process.exit(1);
    }

    // Check for uncommitted changes
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
    }).trim();

    if (status) {
      console.error("Error: Uncommitted changes detected.");
      console.error("       Commit or stash changes before cleanup.");
      process.exit(1);
    }

    // Get the jobs for the commit message
    const jobs = getInstrumentedJobs(instrumentedCommit);
    const jobList = jobs.length > 0 ? jobs.join(", ") : "unknown";

    console.log(`Cleaning up test branch: ${branchState.testBranch}`);
    console.log(`Parent branch: ${branchState.parentBranch}`);
    console.log("");

    // Checkout parent branch
    console.log(`Checking out ${branchState.parentBranch}...`);
    execSync(`git checkout ${branchState.parentBranch}`, {
      encoding: "utf-8",
      stdio: "inherit",
    });

    // Check if there are any changes to squash (compare trees excluding .github)
    // Get the diff between parent and test branch, excluding .github/
    const diff = execSync(
      `git diff ${branchState.parentBranch}...${branchState.testBranch} -- . ':!.github/'`,
      { encoding: "utf-8" },
    ).trim();

    if (!diff) {
      console.log("No changes to merge (only .github/ was modified).");
      console.log("");

      // Just delete the branch
      console.log(`Deleting local branch ${branchState.testBranch}...`);
      execSync(`git branch -D ${branchState.testBranch}`, {
        encoding: "utf-8",
        stdio: "inherit",
      });

      // Try to delete remote branch
      try {
        console.log(`Deleting remote branch ${branchState.testBranch}...`);
        execSync(`git push origin --delete ${branchState.testBranch}`, {
          encoding: "utf-8",
          stdio: "inherit",
        });
      } catch {
        console.log("Remote branch not found or already deleted.");
      }

      console.log("");
      console.log("✓ Cleanup complete (no changes to merge)");
      return;
    }

    // Squash merge the test branch
    console.log("Squash merging changes...");
    execSync(`git merge --squash ${branchState.testBranch}`, {
      encoding: "utf-8",
      stdio: "inherit",
    });

    // Reset .github/ changes (we don't want the instrumentation)
    console.log("Excluding .github/ changes...");
    try {
      execSync("git reset HEAD -- .github/", { encoding: "utf-8" });
      execSync("git checkout -- .github/", { encoding: "utf-8" });
    } catch {
      // .github/ might not have changes, that's fine
    }

    // Check if there are still changes to commit
    const stagedChanges = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
    }).trim();

    if (!stagedChanges) {
      console.log("No non-.github/ changes to commit.");
      execSync("git reset --hard HEAD", { encoding: "utf-8" });
    } else {
      // Commit the squashed changes
      const commitMsg = `Changes from ${branchState.testBranch}

Squashed from test branch (jobs: ${jobList})`;

      execSync(`git commit -m "${commitMsg}"`, {
        encoding: "utf-8",
        stdio: "inherit",
      });
      console.log("✓ Changes committed");
    }

    console.log("");

    // Delete local test branch
    console.log(`Deleting local branch ${branchState.testBranch}...`);
    execSync(`git branch -D ${branchState.testBranch}`, {
      encoding: "utf-8",
      stdio: "inherit",
    });

    // Try to delete remote branch
    try {
      console.log(`Deleting remote branch ${branchState.testBranch}...`);
      execSync(`git push origin --delete ${branchState.testBranch}`, {
        encoding: "utf-8",
        stdio: "inherit",
      });
    } catch {
      console.log("Remote branch not found or already deleted.");
    }

    console.log("");
    console.log("✓ Cleanup complete");
  });
