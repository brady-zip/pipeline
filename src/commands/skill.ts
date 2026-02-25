import { Command } from "commander";

const SKILL_GUIDE = `
# Testing GitHub Workflows with Pipeline

## Overview

Pipeline lets you isolate and test specific GitHub Actions jobs on a throwaway
branch. The core loop is: **enable → push → watch → fix → update → push → repeat**.

## Initial Setup

### 1. Enable the jobs you want to test

\`\`\`bash
pipeline enable <workflow>:<job> [<workflow>:<job> ...]
\`\`\`

This modifies \`.github/workflows/\` to only run your target jobs (plus their
dependencies) and prints the commands to create a test branch.

Use \`pipeline list\` to see available jobs.

### 2. Create the test branch and push

\`\`\`bash
git checkout -b <branch>-pipeline-test
git add .github/
git commit -m $'### DO NOT MERGE\\n\\nTest CI for jobs: ...'
git push -u origin HEAD
\`\`\`

### 3. Create a PR (if needed)

Some workflows require PR context (e.g. \`pull_request\` triggers). Pipeline
detects this and tells you. If needed:

\`\`\`bash
gh pr create --draft --title "$(git log -1 --format=%s)" --body "$(git log -1 --format=%b)"
\`\`\`

### 4. Watch the workflow run

For push-triggered workflows, pipeline prints a one-liner to dispatch and watch:

\`\`\`bash
gh workflow run <workflow>.yml --ref <branch> && sleep 2 && \\
  gh run watch $(gh run list --workflow=<workflow>.yml --limit 1 --json databaseId -q '.[0].databaseId')
\`\`\`

For PR-triggered workflows, the run starts automatically when the PR is created.
Watch it with:

\`\`\`bash
gh run watch
\`\`\`

## The Debug Loop

When a workflow run fails, iterate with this loop:

### 1. Read the logs

Use \`gh run view --log-failed\` to see only the failed step output:

\`\`\`bash
gh run view <run-id> --log-failed
\`\`\`

Or let Claude read the logs using a subagent to analyze failures:

\`\`\`
Use the Bash tool to run: gh run view <run-id> --log-failed
Then analyze the output to determine the root cause.
\`\`\`

### 2. Fix the issue on your parent branch

Switch back to your working branch, make the fix, and commit:

\`\`\`bash
git checkout <parent-branch>
# ... make fixes ...
git add <files>
git commit -m "fix: ..."
\`\`\`

### 3. Hoist the fix onto the test branch

\`pipeline update\` rebases the test branch onto the parent and re-applies
instrumentation:

\`\`\`bash
git checkout <branch>-pipeline-test
pipeline update
\`\`\`

This is equivalent to:
- \`pipeline disable\` (strip instrumentation)
- \`git rebase <parent-branch>\` (pick up your fixes)
- \`pipeline update\` (re-apply instrumentation)

### 4. Force push and re-run

\`\`\`bash
git push --force-with-lease
\`\`\`

For PR-triggered workflows, the push automatically triggers a new run. For
push-triggered workflows, dispatch again:

\`\`\`bash
gh workflow run <workflow>.yml --ref <branch>-pipeline-test
\`\`\`

### 5. Watch and repeat

\`\`\`bash
gh run watch
\`\`\`

If it fails again, go back to step 1.

## Cleanup

Once your workflow passes, clean up the test branch and squash the
instrumentation commit:

\`\`\`bash
pipeline cleanup
\`\`\`

This switches back to the parent branch, deletes the test branch locally and
on the remote, and closes any associated PR.

## Quick Reference

| Step | Command |
|------|---------|
| List jobs | \`pipeline list\` |
| Enable jobs | \`pipeline enable <wf>:<job>\` |
| Show current state | \`pipeline show\` |
| Update after rebase | \`pipeline update\` |
| Strip instrumentation | \`pipeline disable\` |
| Cleanup test branch | \`pipeline cleanup\` |
| Watch run | \`gh run watch\` |
| View failed logs | \`gh run view <id> --log-failed\` |

## Tips

- Use \`pipeline show\` at any time on the test branch to see the current
  instrumentation and suggested commands
- \`--keep-labels\` flag on \`enable\`/\`update\` preserves label-based conditions
  if you need them
- The test branch is always named \`<parent>-pipeline-test\`
- Commit messages start with \`### DO NOT MERGE\` to prevent accidental merges
`.trim();

const FRONTMATTER = `---
name: Testing GitHub Workflows with Pipeline
description: Debug loop for testing GitHub Actions workflows using pipeline enable, push, watch, fix, update, and repeat until successful
---`;

const CLAUDE_FRONTMATTER = `---
name: Testing GitHub Workflows with Pipeline
description: Debug loop for testing GitHub Actions workflows using pipeline enable, push, watch, fix, update, and repeat until successful
allowed-tools: Bash(git *), Bash(gh *), Bash(pipeline *), Read, Grep, Glob
disable-model-invocation: false
---`;

export const skillCommand = new Command("skill")
  .description("Show guide for testing GitHub workflows with pipeline")
  .option(
    "--header [format]",
    "Include frontmatter (use --header=claude for Claude Code skill fields)",
  )
  .action((options: { header?: boolean | string }) => {
    if (options.header) {
      console.log(
        options.header === "claude" ? CLAUDE_FRONTMATTER : FRONTMATTER,
      );
      console.log("");
    }
    console.log(SKILL_GUIDE);
  });
