import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { makeJobKey } from "../types.js";

export const listCommand = new Command("list")
  .description("List all jobs (workflow:job format)")
  .action(async () => {
    const workflows = await parseWorkflows();

    const jobs: string[] = [];
    for (const workflow of workflows.values()) {
      for (const jobId of workflow.jobs.keys()) {
        jobs.push(makeJobKey(workflow.name, jobId));
      }
    }

    jobs.sort();
    for (const job of jobs) {
      console.log(job);
    }
  });
