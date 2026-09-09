import type { Workflow } from "../types.js";
import { parseJobKey } from "../types.js";

export const PR_CONTEXT_PATTERNS = [
  "github.event.pull_request",
  "github.head_ref",
  "github.base_ref",
  "pull_request",
];

export function detectPRContext(
  workflows: Map<string, Workflow>,
  enabledJobs: Set<string>,
  calledWorkflows: Set<string> = new Set(),
): boolean {
  for (const jobKey of enabledJobs) {
    const { workflow, jobId } = parseJobKey(jobKey);
    const wf = workflows.get(workflow);
    if (!wf) continue;

    const job = wf.jobs.get(jobId);
    if (!job) continue;

    // Check job's if condition
    if (job.if && containsPRContext(job.if)) {
      return true;
    }

    // Check workflow triggers. A called workflow's own triggers are stripped
    // down to `workflow_call`, so they say nothing about how the run starts —
    // that is decided by the workflow holding the calling job.
    if (wf.on && !calledWorkflows.has(workflow) && containsPRTrigger(wf.on)) {
      return true;
    }
  }

  return false;
}

export function containsPRContext(text: string): boolean {
  return PR_CONTEXT_PATTERNS.some((pattern) => text.includes(pattern));
}

export function containsPRTrigger(on: unknown): boolean {
  if (typeof on === "string") {
    return on === "pull_request" || on === "pull_request_target";
  }

  if (Array.isArray(on)) {
    return on.some((t) => t === "pull_request" || t === "pull_request_target");
  }

  if (typeof on === "object" && on !== null) {
    return "pull_request" in on || "pull_request_target" in on;
  }

  return false;
}
