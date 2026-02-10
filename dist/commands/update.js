import { execSync } from "child_process";
import { Command } from "commander";
import { parseWorkflows } from "../lib/parser.js";
import { buildDependencyGraph } from "../lib/graph.js";
import { modifyWorkflows } from "../lib/modifier.js";
import { detectPRContext } from "../lib/detector.js";
import { parseJobKey } from "../types.js";
import { TEST_BRANCH_SUFFIX, detectBranchState, findInstrumentedCommit, getInstrumentedJobs, hoistInstrumentedCommit, } from "../lib/branch.js";
export const updateCommand = new Command("update")
    .description("Update instrumentation after rebase")
    .option("--keep-labels", "Preserve label-based conditions")
    .action(async (options) => {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
    }).trim();
    // Must be on a test branch
    if (!currentBranch.endsWith(TEST_BRANCH_SUFFIX)) {
        console.error("Error: Not on a test branch.");
        console.error("       Use 'pipeline enable' to create a new test branch.");
        process.exit(1);
    }
    const branchState = detectBranchState(currentBranch);
    // Find instrumented commit
    let instrumentedCommit = findInstrumentedCommit();
    if (!instrumentedCommit) {
        console.error("Error: No instrumented commit found.");
        console.error("       Use 'pipeline enable' to create instrumentation.");
        process.exit(1);
    }
    // Parse jobs from the instrumented commit
    const jobs = getInstrumentedJobs(instrumentedCommit);
    if (jobs.length === 0) {
        console.error("Error: Could not parse jobs from instrumented commit.");
        process.exit(1);
    }
    console.log(`Found instrumented jobs: ${jobs.join(", ")}`);
    // Hoist instrumented commit to HEAD if needed
    const headHash = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
    }).trim();
    if (instrumentedCommit !== headHash) {
        console.log("Hoisting instrumented commit to HEAD...");
        hoistInstrumentedCommit(instrumentedCommit);
        instrumentedCommit = execSync("git rev-parse HEAD", {
            encoding: "utf-8",
        }).trim();
    }
    // Parse workflows and build graph
    const workflows = await parseWorkflows();
    const graph = buildDependencyGraph(workflows);
    // Validate all target jobs still exist
    for (const job of jobs) {
        if (!graph.jobs.has(job)) {
            console.error(`Error: Job "${job}" no longer exists in workflows.`);
            process.exit(1);
        }
    }
    let enabledJobs;
    try {
        enabledJobs = graph.getRequiredJobs(jobs);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes("Circular dependency")) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
        throw err;
    }
    const allJobs = new Set(graph.jobs.keys());
    const disabledJobs = new Set([...allJobs].filter((j) => !enabledJobs.has(j)));
    await modifyWorkflows(workflows, enabledJobs, {
        keepLabels: options.keepLabels,
    });
    const needsPRContext = detectPRContext(workflows, enabledJobs);
    // Output
    const enabledList = Array.from(enabledJobs).sort().join(", ");
    console.log(`✓ Enabled ${enabledJobs.size} jobs: ${enabledList}`);
    console.log(`✓ Disabled ${disabledJobs.size} jobs`);
    console.log("");
    // Get unique workflows with enabled jobs
    const workflowsToRun = new Set();
    for (const job of enabledJobs) {
        const { workflow } = parseJobKey(job);
        workflowsToRun.add(workflow);
    }
    const jobList = Array.from(enabledJobs).sort().join(", ");
    const commitMsg = `### DO NOT MERGE

Test CI for jobs: ${jobList}

Created by \`pipeline enable\` from [${branchState.parentBranch}](../tree/${branchState.parentBranch})`;
    const escapedCommitMsg = commitMsg
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n");
    console.log("To test:");
    console.log("  git add .github/");
    console.log(`  git commit --amend -m $'${escapedCommitMsg}'`);
    console.log("  git push --force-with-lease");
    if (needsPRContext) {
        console.log("  REPO_ID=$(git remote get-url origin | sed 's/.*github.com[:\\/]\\(.*\\).git/\\1/')");
        console.log("  gh pr create --fill --repo $REPO_ID");
    }
    else {
        const workflowFile = Array.from(workflowsToRun)[0] + ".yml";
        console.log(`  gh workflow run ${workflowFile} --ref ${branchState.testBranch} && sleep 2 && gh run watch $(gh run list --workflow=${workflowFile} --limit 1 --json databaseId -q '.[0].databaseId') && osascript -e 'display notification "Workflow complete" with title "pipeline"'`);
    }
    console.log("");
    console.log("To cleanup:");
    console.log("  pipeline cleanup");
});
