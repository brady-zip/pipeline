import { readFile } from "fs/promises";
import { glob } from "glob";
import { parse } from "yaml";
import { basename } from "path";
import type { Job, Workflow } from "../types.js";
import { makeJobKey } from "../types.js";

interface RawJob {
  needs?: string | string[];
  uses?: string;
  if?: string;
  "runs-on"?: string;
}

interface RawWorkflow {
  on?: unknown;
  jobs?: Record<string, RawJob>;
}

export async function parseWorkflows(
  workflowDir = ".github/workflows",
): Promise<Map<string, Workflow>> {
  const files = await glob(`${workflowDir}/*.yml`);
  const workflows = new Map<string, Workflow>();

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const raw = parse(content) as RawWorkflow;
    const name = basename(file, ".yml");

    const jobs = new Map<string, Job>();

    if (raw.jobs) {
      for (const [jobId, rawJob] of Object.entries(raw.jobs)) {
        const needs = normalizeNeeds(rawJob.needs).map((need) =>
          makeJobKey(name, need),
        );

        jobs.set(jobId, {
          id: jobId,
          workflow: name,
          needs,
          uses: rawJob.uses,
          usesWorkflow: resolveUsedWorkflow(rawJob.uses),
          if: rawJob.if,
          runsOn: rawJob["runs-on"],
        });
      }
    }

    workflows.set(name, {
      name,
      path: file,
      jobs,
      on: raw.on,
    });
  }

  return workflows;
}

function normalizeNeeds(needs: string | string[] | undefined): string[] {
  if (!needs) return [];
  return Array.isArray(needs) ? needs : [needs];
}

/**
 * Name of the local reusable workflow a job invokes, or undefined if the job
 * does not call one. `graph.ts` uses this to cross the `uses:` boundary in both
 * directions: a caller needs the workflow's jobs, and those jobs only run when
 * the caller does.
 */
function resolveUsedWorkflow(uses?: string): string | undefined {
  if (!uses?.startsWith("./.github/workflows/")) return undefined;
  const match = uses.match(/\.\/\.github\/workflows\/([^.]+)\.yml/);
  return match ? match[1] : undefined;
}
