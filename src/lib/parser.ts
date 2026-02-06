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
        const needs = normalizeNeeds(rawJob.needs);
        const resolvedNeeds = resolveNeeds(name, needs, rawJob.uses);

        jobs.set(jobId, {
          id: jobId,
          workflow: name,
          needs: resolvedNeeds,
          uses: rawJob.uses,
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

function resolveNeeds(
  currentWorkflow: string,
  needs: string[],
  uses?: string,
): string[] {
  const resolved: string[] = [];

  // Local job dependencies (within same workflow)
  for (const need of needs) {
    resolved.push(makeJobKey(currentWorkflow, need));
  }

  // Reusable workflow dependency
  if (uses?.startsWith("./.github/workflows/")) {
    const match = uses.match(/\.\/\.github\/workflows\/([^.]+)\.yml/);
    if (match) {
      const reusedWorkflow = match[1];
      // The caller job depends on all jobs in the reused workflow
      // We mark it as depending on the workflow itself, resolved later in graph
      resolved.push(`${reusedWorkflow}:*`);
    }
  }

  return resolved;
}
