import { readFile } from "fs/promises";
import { parseDocument, YAMLMap, Scalar } from "yaml";
import type { DependencyGraph, Workflow } from "../types.js";
import { parseJobKey } from "../types.js";
import type { ModifyResult } from "./modifier.js";

export interface Warning {
  title: string;
  detail: string[];
}

interface WarningInput {
  workflows: Map<string, Workflow>;
  graph: DependencyGraph;
  enabledJobs: Set<string>;
  calledWorkflows: Set<string>;
  modifyResult: ModifyResult;
}

/**
 * Conditions and repo-level gates that leave an enabled job reporting
 * "skipped" rather than failing. These are the cases where a run looks clean
 * but the job under test never executed, so they have to be said out loud.
 */
export async function collectWarnings(input: WarningInput): Promise<Warning[]> {
  const warnings: Warning[] = [];

  const inputGated = input.modifyResult.conditionChanges.filter(
    (change) => change.action === "kept" && /\binputs\./.test(change.condition),
  );
  if (inputGated.length > 0) {
    warnings.push({
      title: "Enabled jobs still gate on workflow inputs",
      detail: [
        ...inputGated.map((change) => `${change.jobKey} — ${change.condition}`),
        "These evaluate against what the calling job passes in `with:`, so the",
        "job skips unless this branch's diff makes those inputs truthy. Touch a",
        "file the caller keys off, or relax the condition on the parent branch.",
      ],
    });
  }

  for (const workflowName of input.calledWorkflows) {
    const callers = input.graph
      .getCallerJobs(workflowName)
      .filter((caller) => input.enabledJobs.has(caller));
    if (callers.length > 1) {
      warnings.push({
        title: `${workflowName}.yml is invoked by ${callers.length} enabled jobs`,
        detail: [
          `Callers: ${callers.sort().join(", ")}`,
          "Each one starts its own copy of the workflow, so expect duplicate runs.",
        ],
      });
    }
  }

  const draftGates = await findDraftGates(input.workflows, input.enabledJobs);
  if (draftGates.length > 0) {
    warnings.push({
      title: "This repo looks like it skips CI on draft PRs",
      detail: [
        ...draftGates,
        "A draft PR would report every job as skipped with no error pointing at",
        "why. Pass the repo's CI-opt-in label (e.g. `--pr-label run-ci`) so it is",
        "set when the PR is created, or drop `--draft` from the line below.",
        "Labelling an already-open PR does not help on its own: `pull_request`",
        "does not fire on `labeled`, so no new run starts. Re-run the existing",
        "one instead — `gh run rerun <id>`.",
      ],
    });
  }

  return warnings;
}

/**
 * Lines that plausibly gate on draft status, as opposed to merely mentioning
 * the word: the draft context itself, a condition referencing it, or a
 * step/action whose name says it checks drafts. Deliberately excludes things
 * like `draft: false` inputs and step names such as "Create draft release".
 */
const DRAFT_GATE_PATTERNS = [
  /pull_request\.draft/,
  /^\s*(-\s*)?if:.*\bdraft\b/i,
  /^\s*(-\s*)?uses:.*draft/i,
];

/**
 * Scan only the enabled jobs' own YAML for draft-PR references — a disabled
 * job's gate cannot skip anything.
 */
async function findDraftGates(
  workflows: Map<string, Workflow>,
  enabledJobs: Set<string>,
): Promise<string[]> {
  const enabledByWorkflow = new Map<string, Set<string>>();
  for (const jobKey of enabledJobs) {
    const { workflow, jobId } = parseJobKey(jobKey);
    if (!enabledByWorkflow.has(workflow)) {
      enabledByWorkflow.set(workflow, new Set());
    }
    enabledByWorkflow.get(workflow)!.add(jobId);
  }

  const hits: string[] = [];

  for (const [workflowName, jobIds] of enabledByWorkflow) {
    const workflow = workflows.get(workflowName);
    if (!workflow) continue;

    let content: string;
    let doc;
    try {
      content = await readFile(workflow.path, "utf-8");
      doc = parseDocument(content);
    } catch {
      continue;
    }

    const jobsNode = doc.get("jobs");
    if (!(jobsNode instanceof YAMLMap)) continue;

    for (const item of jobsNode.items) {
      const jobId = String((item.key as Scalar).value);
      if (!jobIds.has(jobId)) continue;

      // Slice the job's own source range so the reported line is the one the
      // repo actually wrote, not a re-serialized approximation.
      const range = (item.value as { range?: [number, number, number] })?.range;
      if (!range) continue;

      for (const line of content.slice(range[0], range[2]).split("\n")) {
        if (!DRAFT_GATE_PATTERNS.some((pattern) => pattern.test(line)))
          continue;
        hits.push(`${workflowName}:${jobId} — ${line.trim()}`);
      }
    }
  }

  return hits.slice(0, 8);
}

export function printWarnings(warnings: Warning[]): void {
  for (const warning of warnings) {
    console.log(`⚠ ${warning.title}`);
    for (const line of warning.detail) {
      console.log(`  ${line}`);
    }
    console.log("");
  }
}
