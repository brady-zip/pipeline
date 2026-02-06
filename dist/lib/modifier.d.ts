import type { Workflow } from "../types.js";
interface ModifyOptions {
    keepLabels?: boolean;
}
export declare function modifyWorkflows(workflows: Map<string, Workflow>, enabledJobs: Set<string>, options?: ModifyOptions): Promise<void>;
export {};
