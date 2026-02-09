import { execSync } from "child_process";
export const TEST_BRANCH_SUFFIX = "-test-ci";
export const ENABLE_COMMIT_MARKER = "### DO NOT MERGE";
export function detectBranchState(currentBranch) {
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
export function findInstrumentedCommit() {
    const log = execSync(`git log --oneline --format="%H %s" -n 50`, {
        encoding: "utf-8",
    });
    for (const line of log.split("\n")) {
        const [hash] = line.split(" ", 1);
        if (!hash)
            continue;
        const msg = execSync(`git log -1 --format=%B ${hash}`, {
            encoding: "utf-8",
        });
        if (msg.startsWith(ENABLE_COMMIT_MARKER)) {
            return hash;
        }
    }
    return null;
}
export function hoistInstrumentedCommit(commitHash) {
    // Check for merge commits between HEAD and the instrumented commit
    const mergeCheck = execSync(`git log --merges ${commitHash}..HEAD --oneline`, { encoding: "utf-8" }).trim();
    if (mergeCheck) {
        console.error("Error: Merge commits found between instrumented commit and HEAD.");
        console.error("       Run 'pipeline disable' first, resolve conflicts, then re-enable.");
        process.exit(1);
    }
    // Reorder commits: move instrumented commit to top
    execSync(`git rebase --onto ${commitHash}^ ${commitHash} HEAD && git cherry-pick ${commitHash}`, { encoding: "utf-8", stdio: "inherit" });
}
export function getInstrumentedJobs(commitHash) {
    const msg = execSync(`git log -1 --format=%B ${commitHash}`, {
        encoding: "utf-8",
    });
    const match = msg.match(/^Test CI for jobs: (.+)$/m);
    if (!match) {
        return [];
    }
    return match[1].split(", ").map((j) => j.trim());
}
export function hasNonInstrumentedChanges(parentBranch, instrumentedCommit) {
    const mergeBase = execSync(`git merge-base ${parentBranch} HEAD`, {
        encoding: "utf-8",
    }).trim();
    // Count commits between merge-base and the commit before the instrumented one
    const count = execSync(`git rev-list --count ${mergeBase}..${instrumentedCommit}^`, { encoding: "utf-8" }).trim();
    return parseInt(count, 10) > 0;
}
