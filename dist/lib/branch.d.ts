export declare const TEST_BRANCH_SUFFIX = "-test-ci";
export declare const ENABLE_COMMIT_MARKER = "### DO NOT MERGE";
export declare function detectBranchState(currentBranch: string): {
    isTestBranch: boolean;
    parentBranch: string;
    testBranch: string;
};
export declare function findInstrumentedCommit(): string | null;
export declare function hoistInstrumentedCommit(commitHash: string): void;
export declare function getInstrumentedJobs(commitHash: string): string[];
export declare function hasNonInstrumentedChanges(parentBranch: string, instrumentedCommit: string): boolean;
