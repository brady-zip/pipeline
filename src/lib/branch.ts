import { $ } from "bun";

export const TEST_BRANCH_SUFFIX = "-test-ci";
export const ENABLE_COMMIT_MARKER = "### DO NOT MERGE";

export function detectBranchState(currentBranch: string): {
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

export async function findInstrumentedCommit(): Promise<string | null> {
  const log = await $`git log --oneline --format="%H %s" -n 50`.text();

  for (const line of log.split("\n")) {
    const [hash] = line.split(" ", 1);
    if (!hash) continue;

    const msg = await $`git log -1 --format=%B ${hash}`.text();
    if (msg.startsWith(ENABLE_COMMIT_MARKER)) {
      return hash;
    }
  }
  return null;
}

export async function hoistInstrumentedCommit(
  commitHash: string,
): Promise<void> {
  // Check for merge commits between HEAD and the instrumented commit
  const mergeCheck = (
    await $`git log --merges ${commitHash}..HEAD --oneline`.text()
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
  await $`git rebase --onto ${commitHash}^ ${commitHash} HEAD && git cherry-pick ${commitHash}`;
}

export async function getInstrumentedJobs(
  commitHash: string,
): Promise<string[]> {
  const msg = await $`git log -1 --format=%B ${commitHash}`.text();

  const match = msg.match(/^Test CI for jobs: (.+)$/m);
  if (!match) {
    return [];
  }

  return match[1].split(", ").map((j) => j.trim());
}

export async function hasNonInstrumentedChanges(
  parentBranch: string,
  instrumentedCommit: string,
): Promise<boolean> {
  const mergeBase = (
    await $`git merge-base ${parentBranch} HEAD`.text()
  ).trim();

  // Count commits between merge-base and the commit before the instrumented one
  const count = (
    await $`git rev-list --count ${mergeBase}..${instrumentedCommit}^`.text()
  ).trim();

  return parseInt(count, 10) > 0;
}
