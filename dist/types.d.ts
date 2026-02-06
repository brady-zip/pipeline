export interface Job {
    id: string;
    workflow: string;
    needs: string[];
    uses?: string;
    if?: string;
    runsOn?: string;
}
export interface Workflow {
    name: string;
    path: string;
    jobs: Map<string, Job>;
    on: unknown;
}
export interface DependencyGraph {
    jobs: Map<string, Job>;
    getDependencies(jobKey: string): Set<string>;
    getRequiredJobs(targets: string[]): Set<string>;
}
export type JobKey = `${string}:${string}`;
export declare function makeJobKey(workflow: string, jobId: string): JobKey;
export declare function parseJobKey(key: string): {
    workflow: string;
    jobId: string;
};
