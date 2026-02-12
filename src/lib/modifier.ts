import { readFile, writeFile } from "fs/promises";
import { parseDocument, YAMLMap, Scalar, Pair } from "yaml";
import type { Workflow } from "../types.js";
import { parseJobKey } from "../types.js";
import {
  PR_CONTEXT_PATTERNS,
  containsPRContext,
  containsPRTrigger,
} from "./detector.js";

interface ModifyOptions {
  keepLabels?: boolean;
  keepPRContext?: boolean;
}

export async function modifyWorkflows(
  workflows: Map<string, Workflow>,
  enabledJobs: Set<string>,
  options: ModifyOptions = {},
): Promise<void> {
  // Group enabled jobs by workflow
  const enabledByWorkflow = new Map<string, Set<string>>();
  for (const jobKey of enabledJobs) {
    const { workflow, jobId } = parseJobKey(jobKey);
    if (!enabledByWorkflow.has(workflow)) {
      enabledByWorkflow.set(workflow, new Set());
    }
    enabledByWorkflow.get(workflow)!.add(jobId);
  }

  for (const workflow of workflows.values()) {
    const content = await readFile(workflow.path, "utf-8");
    const doc = parseDocument(content);
    const enabledInWorkflow = enabledByWorkflow.get(workflow.name) ?? new Set();

    const hasEnabledJobs = enabledInWorkflow.size > 0;

    // Check if any enabled job in this workflow needs PR context
    const needsPRContext =
      hasEnabledJobs &&
      (containsPRTrigger(workflow.on) ||
        [...enabledInWorkflow].some((jobId) => {
          const job = workflow.jobs.get(jobId);
          return job?.if && containsPRContext(job.if);
        }));

    // Modify triggers if workflow has enabled jobs
    if (hasEnabledJobs) {
      modifyTriggers(doc, needsPRContext);
    }

    // Modify jobs
    const jobsNode = doc.get("jobs") as YAMLMap | undefined;
    if (jobsNode && jobsNode instanceof YAMLMap) {
      for (const item of jobsNode.items) {
        const jobId = String((item.key as Scalar).value);
        const jobNode = item.value as YAMLMap;

        if (enabledInWorkflow.has(jobId)) {
          // Enable: remove if condition (preserving labels/PR context as configured)
          removeIfCondition(jobNode, options);
        } else {
          // Disable: add if: false
          addIfFalse(jobNode);
        }
      }
    }

    cleanWorkflowDocument(doc);
    await writeFile(workflow.path, doc.toString({ lineWidth: 100 }));
  }
}

function modifyTriggers(
  doc: ReturnType<typeof parseDocument>,
  needsPRContext: boolean,
): void {
  if (needsPRContext) {
    doc.set("on", ["pull_request", "workflow_dispatch"]);
  } else {
    doc.set("on", ["push", "workflow_dispatch"]);
  }
}

function removeIfCondition(jobNode: YAMLMap, options: ModifyOptions): void {
  const ifIdx = jobNode.items.findIndex(
    (item) => (item.key as Scalar).value === "if",
  );

  if (ifIdx === -1) return;

  const ifValue = String((jobNode.items[ifIdx].value as Scalar).value);

  // Check if it's a label-based condition
  const isLabelCondition =
    ifValue.includes("label") ||
    ifValue.includes("github.event.pull_request.labels");

  if (options.keepLabels && isLabelCondition) {
    return;
  }

  // Preserve PR-context conditions by default
  const keepPRContext = options.keepPRContext !== false;
  if (keepPRContext && PR_CONTEXT_PATTERNS.some((p) => ifValue.includes(p))) {
    return;
  }

  jobNode.items.splice(ifIdx, 1);
}

function addIfFalse(jobNode: YAMLMap): void {
  // Check if if: false already exists
  const existing = jobNode.items.find(
    (item) => (item.key as Scalar).value === "if",
  );

  if (existing) {
    (existing.value as Scalar).value = false;
  } else {
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

function cleanWorkflowDocument(doc: ReturnType<typeof parseDocument>): void {
  if (!(doc.contents instanceof YAMLMap)) return;

  // Remove any invalid top-level properties
  const invalidItems: number[] = [];
  for (let i = 0; i < doc.contents.items.length; i++) {
    const key = String((doc.contents.items[i].key as Scalar).value);
    if (!VALID_WORKFLOW_KEYS.has(key)) {
      invalidItems.push(i);
    }
  }

  // Remove in reverse order to maintain indices
  for (let i = invalidItems.length - 1; i >= 0; i--) {
    doc.contents.items.splice(invalidItems[i], 1);
  }
}
