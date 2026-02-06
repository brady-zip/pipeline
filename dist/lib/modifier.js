import { readFile, writeFile } from "fs/promises";
import { parseDocument, YAMLMap, Scalar, Pair } from "yaml";
import { parseJobKey } from "../types.js";
export async function modifyWorkflows(workflows, enabledJobs, options = {}) {
    // Group enabled jobs by workflow
    const enabledByWorkflow = new Map();
    for (const jobKey of enabledJobs) {
        const { workflow, jobId } = parseJobKey(jobKey);
        if (!enabledByWorkflow.has(workflow)) {
            enabledByWorkflow.set(workflow, new Set());
        }
        enabledByWorkflow.get(workflow).add(jobId);
    }
    for (const workflow of workflows.values()) {
        const content = await readFile(workflow.path, "utf-8");
        const doc = parseDocument(content);
        const enabledInWorkflow = enabledByWorkflow.get(workflow.name) ?? new Set();
        const hasEnabledJobs = enabledInWorkflow.size > 0;
        // Modify triggers if workflow has enabled jobs
        if (hasEnabledJobs) {
            modifyTriggers(doc);
        }
        // Modify jobs
        const jobsNode = doc.get("jobs");
        if (jobsNode && jobsNode instanceof YAMLMap) {
            for (const item of jobsNode.items) {
                const jobId = String(item.key.value);
                const jobNode = item.value;
                if (enabledInWorkflow.has(jobId)) {
                    // Enable: remove if condition (unless label-based and keepLabels)
                    removeIfCondition(jobNode, options.keepLabels);
                }
                else {
                    // Disable: add if: false
                    addIfFalse(jobNode);
                }
            }
        }
        cleanWorkflowDocument(doc);
        await writeFile(workflow.path, doc.toString({ lineWidth: 100 }));
    }
}
function modifyTriggers(doc) {
    doc.set("on", ["push", "workflow_dispatch"]);
}
function removeIfCondition(jobNode, keepLabels) {
    const ifIdx = jobNode.items.findIndex((item) => item.key.value === "if");
    if (ifIdx === -1)
        return;
    const ifValue = String(jobNode.items[ifIdx].value.value);
    // Check if it's a label-based condition
    const isLabelCondition = ifValue.includes("label") ||
        ifValue.includes("github.event.pull_request.labels");
    if (keepLabels && isLabelCondition) {
        return;
    }
    jobNode.items.splice(ifIdx, 1);
}
function addIfFalse(jobNode) {
    // Check if if: false already exists
    const existing = jobNode.items.find((item) => item.key.value === "if");
    if (existing) {
        existing.value.value = false;
    }
    else {
        // Add if: false at the beginning
        const ifPair = new Pair(new Scalar("if"), new Scalar(false));
        jobNode.items.unshift(ifPair);
    }
}
// Valid top-level GitHub Actions workflow properties
const VALID_WORKFLOW_KEYS = new Set([
    "name",
    "on",
    "env",
    "concurrency",
    "defaults",
    "jobs",
    "permissions",
]);
function cleanWorkflowDocument(doc) {
    if (!(doc.contents instanceof YAMLMap))
        return;
    // Remove any invalid top-level properties
    const invalidItems = [];
    for (let i = 0; i < doc.contents.items.length; i++) {
        const key = String(doc.contents.items[i].key.value);
        if (!VALID_WORKFLOW_KEYS.has(key)) {
            invalidItems.push(i);
        }
    }
    // Remove in reverse order to maintain indices
    for (let i = invalidItems.length - 1; i >= 0; i--) {
        doc.contents.items.splice(invalidItems[i], 1);
    }
}
