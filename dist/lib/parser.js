import { readFile } from "fs/promises";
import { glob } from "glob";
import { parse } from "yaml";
import { basename } from "path";
import { makeJobKey } from "../types.js";
export async function parseWorkflows(workflowDir = ".github/workflows") {
    const files = await glob(`${workflowDir}/*.yml`);
    const workflows = new Map();
    for (const file of files) {
        const content = await readFile(file, "utf-8");
        const raw = parse(content);
        const name = basename(file, ".yml");
        const jobs = new Map();
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
function normalizeNeeds(needs) {
    if (!needs)
        return [];
    return Array.isArray(needs) ? needs : [needs];
}
function resolveNeeds(currentWorkflow, needs, uses) {
    const resolved = [];
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
