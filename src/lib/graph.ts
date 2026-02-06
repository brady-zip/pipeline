import type { DependencyGraph, Job, Workflow } from "../types.js";
import { makeJobKey } from "../types.js";

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

  // Resolve wildcard references (workflow:*)
  for (const job of jobs.values()) {
    job.needs = job.needs.flatMap((need) => {
      if (need.endsWith(":*")) {
        const workflowName = need.slice(0, -2);
        const wf = workflows.get(workflowName);
        if (!wf) {
          throw new Error(`Referenced workflow not found: ${workflowName}`);
        }
        return Array.from(wf.jobs.keys()).map((jid) =>
          makeJobKey(workflowName, jid),
        );
      }
      return [need];
    });
  }

  function getDependencies(jobKey: string): Set<string> {
    const job = jobs.get(jobKey);
    if (!job) return new Set();
    return new Set(job.needs);
  }

  function getRequiredJobs(targets: string[]): Set<string> {
    const required = new Set<string>();
    const visited = new Set<string>();
    const path: string[] = [];

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

      const deps = getDependencies(jobKey);
      for (const dep of deps) {
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

    return required;
  }

  return { jobs, getDependencies, getRequiredJobs };
}
