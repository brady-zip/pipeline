import type { DependencyGraph, Job, Workflow } from "../types.js";
import { makeJobKey, parseJobKey } from "../types.js";

export function buildDependencyGraph(
  workflows: Map<string, Workflow>,
): DependencyGraph {
  const jobs = new Map<string, Job>();

  // Collect all jobs
  for (const workflow of workflows.values()) {
    for (const [jobId, job] of workflow.jobs) {
      jobs.set(makeJobKey(workflow.name, jobId), job);
    }
  }

  // Index the `uses:` edges by callee so the graph can be walked upwards
  const callerJobs = new Map<string, string[]>();
  for (const [jobKey, job] of jobs) {
    if (!job.usesWorkflow) continue;
    if (!workflows.has(job.usesWorkflow)) {
      throw new Error(`Referenced workflow not found: ${job.usesWorkflow}`);
    }
    const callers = callerJobs.get(job.usesWorkflow) ?? [];
    callers.push(jobKey);
    callerJobs.set(job.usesWorkflow, callers);
  }

  function jobKeysIn(workflowName: string): string[] {
    const wf = workflows.get(workflowName);
    if (!wf) return [];
    return Array.from(wf.jobs.keys(), (jobId) =>
      makeJobKey(workflowName, jobId),
    );
  }

  function getCallerJobs(workflowName: string): string[] {
    return callerJobs.get(workflowName) ?? [];
  }

  /**
   * A job's dependencies: its own `needs:` plus, for a job that invokes a
   * reusable workflow, that workflow's jobs.
   *
   * `selectiveWorkflows` names workflows the caller is deliberately running
   * only part of, and so suppresses the second half for those — otherwise
   * naming one job inside a reusable workflow would drag in all of them.
   */
  function dependenciesOf(
    jobKey: string,
    selectiveWorkflows: Set<string>,
  ): Set<string> {
    const job = jobs.get(jobKey);
    if (!job) return new Set();
    const deps = new Set(job.needs);
    if (job.usesWorkflow && !selectiveWorkflows.has(job.usesWorkflow)) {
      for (const dep of jobKeysIn(job.usesWorkflow)) deps.add(dep);
    }
    return deps;
  }

  function getDependencies(jobKey: string): Set<string> {
    return dependenciesOf(jobKey, new Set());
  }

  function getRequiredJobs(targets: string[]): Set<string> {
    const required = new Set<string>();
    const visited = new Set<string>();
    const path: string[] = [];

    // Workflows the caller is being selective inside. A job that calls one of
    // these must not drag in every job it contains — that would undo the whole
    // point of naming a single job in a reusable workflow.
    const targetWorkflows = new Set(
      targets.map((target) => parseJobKey(target).workflow),
    );

    function visit(jobKey: string) {
      if (visited.has(jobKey)) {
        if (path.includes(jobKey)) {
          const cycle = [...path.slice(path.indexOf(jobKey)), jobKey];
          throw new Error(
            `Circular dependency detected: ${cycle.join(" -> ")}`,
          );
        }
        return;
      }

      path.push(jobKey);
      visited.add(jobKey);
      required.add(jobKey);

      for (const dep of dependenciesOf(jobKey, targetWorkflows)) {
        if (!jobs.has(dep)) {
          throw new Error(
            `Missing dependency: ${jobKey} requires ${dep} which does not exist`,
          );
        }
        visit(dep);
      }

      path.pop();
    }

    for (const target of targets) {
      visit(target);
    }

    // A job in a reusable workflow only runs when the job that calls that
    // workflow runs, so walk up every `uses:` edge (and the callers' own
    // `needs:`) until no new callers turn up.
    for (let changed = true; changed; ) {
      changed = false;
      const enabledWorkflows = new Set(
        Array.from(required, (jobKey) => parseJobKey(jobKey).workflow),
      );
      for (const workflowName of enabledWorkflows) {
        for (const callerKey of getCallerJobs(workflowName)) {
          if (required.has(callerKey)) continue;
          visit(callerKey);
          changed = true;
        }
      }
    }

    return required;
  }

  return { jobs, getDependencies, getCallerJobs, getRequiredJobs };
}

/**
 * Workflows that the enabled set reaches through `uses:` rather than through
 * their own triggers. These must stay `workflow_call`-only: dispatching them
 * standalone leaves `inputs.*` empty, which silently skips their jobs.
 */
export function getCalledWorkflows(
  graph: DependencyGraph,
  enabledJobs: Set<string>,
): Set<string> {
  const called = new Set<string>();
  for (const jobKey of enabledJobs) {
    const { workflow } = parseJobKey(jobKey);
    if (called.has(workflow)) continue;
    const enabledCallers = graph
      .getCallerJobs(workflow)
      .filter((caller) => enabledJobs.has(caller));
    if (enabledCallers.length > 0) called.add(workflow);
  }
  return called;
}
