import { readFile, writeFile } from "fs/promises";
import { parseDocument, YAMLMap, Scalar, Pair } from "yaml";
import type { Workflow } from "../types.js";
import { parseJobKey } from "../types.js";

interface ModifyOptions {
  keepLabels?: boolean;
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

    // Modify triggers if workflow has enabled jobs
    if (hasEnabledJobs) {
      modifyTriggers(doc);
    }

    // Modify jobs
    const jobsNode = doc.get("jobs") as YAMLMap | undefined;
    if (jobsNode && jobsNode instanceof YAMLMap) {
      for (const item of jobsNode.items) {
        const jobId = String((item.key as Scalar).value);
        const jobNode = item.value as YAMLMap;

        if (enabledInWorkflow.has(jobId)) {
          // Enable: remove if condition (unless label-based and keepLabels)
          removeIfCondition(jobNode, options.keepLabels);
        } else {
          // Disable: add if: false
          addIfFalse(jobNode);
        }
      }
    }

    await writeFile(workflow.path, doc.toString());
  }
}

function modifyTriggers(doc: ReturnType<typeof parseDocument>): void {
  doc.set("on", ["push", "workflow_dispatch"]);
}

function removeIfCondition(jobNode: YAMLMap, keepLabels?: boolean): void {
  const ifIdx = jobNode.items.findIndex(
    (item) => (item.key as Scalar).value === "if",
  );

  if (ifIdx === -1) return;

  const ifValue = String((jobNode.items[ifIdx].value as Scalar).value);

  // Check if it's a label-based condition
  const isLabelCondition =
    ifValue.includes("label") ||
    ifValue.includes("github.event.pull_request.labels");

  if (keepLabels && isLabelCondition) {
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
