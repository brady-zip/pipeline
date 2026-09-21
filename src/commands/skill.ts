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
git checkout -b <branch>-test-ci
git add .github/
git commit -m $'### DO NOT MERGE\\n\\nTest CI for jobs: ...'
git push -u origin HEAD
\`\`\`

### 3. Create a PR (if needed)

Some workflows require PR context (e.g. \`pull_request\` triggers). Pipeline
detects this and tells you. If needed:

\`\`\`bash
gh pr create --draft --title "$(git log -1 --format=%s)" --body "$(git log -1 --format=%b)" --label run-ci
\`\`\`

**The \`run-ci\` label is applied by default.** Pipeline puts \`--label run-ci\`
on every \`gh pr create\` line it prints, because many repos skip CI entirely
on draft PRs (a \`pre-flight\` job checking
\`github.event.pull_request.draft\`) and use an opt-in label as the escape
hatch. Without it, such a repo produces a run where every job — including the
one under test — reports \`skipping\`, with no error explaining why. Use the
printed command as-is and keep the label.

Two cases need a flag:

\`\`\`bash
# repo gates on a different (or an additional) label
pipeline enable <workflow>:<job> --pr-label my-ci-label

# repo has no run-ci label at all — gh pr create errors on an unknown label
pipeline enable <workflow>:<job> --no-run-ci-label
\`\`\`

The label has to be set **when the PR is created**, which is why it is on the
\`gh pr create\` line rather than added afterwards. Adding it to an already-open
PR does nothing by itself: the \`pull_request\` trigger does not fire on the
\`labeled\` action, so no new run starts and the PR keeps its original all-skip
result with nothing marked pending. If you have already opened an unlabelled
PR, label it and then re-run the existing run — gates that re-read labels from
the API pick it up:

\`\`\`bash
gh pr edit --add-label run-ci
gh run rerun <run-id>
\`\`\`

If a run comes back entirely skipped, read the first gating job's logs before
assuming the instrumentation is wrong.

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

**Rule: Never give up after a single failure.** When a run fails, investigate the logs,
diagnose the root cause, fix it, and re-run. Do NOT present the user with a menu of options
or ask what they want to do — just drive the loop. The whole point of pipeline is to iterate
until the job passes. Only stop and ask if you've exhausted your ideas after multiple attempts
or if the fix requires a decision that's genuinely outside your judgment (e.g. a product
decision, not a technical one).

**Rule: Keep the parent branch clean.**

- **Non-.github/ test artifacts** (inflated baselines, mock data, etc.) must NOT be committed
  on the test branch. Pipeline cleanup merges all non-.github/ changes back to the parent.
  If you need to simulate a failure, include those changes in the instrumentation commit
  alongside .github/ files so cleanup excludes them.
- **Real .github/ workflow fixes** must be applied on the parent branch first, then run
  \`pipeline update\` to re-instrument on top. Do NOT fix .github/ files only on the test
  branch — cleanup excludes all .github/ changes, so the fix will be lost.

When a workflow run fails, iterate with this loop:

### 1. Read the logs and diagnose

Use \`gh run view --log-failed\` to see only the failed step output:

\`\`\`bash
gh run view <run-id> --log-failed
\`\`\`

Diagnose the root cause. Failures often fall into these categories:
- **Pre-existing issues** (missing files, broken config): fix them on the parent branch
- **Your changes broke something**: fix on the parent branch, then \`pipeline update\`
- **Flaky/infra failures** (timeouts, rate limits): just re-push to retry

If the logs are too large, use a subagent to analyze them. The key is to identify the
root cause and act on it — don't just report the error back to the user.

### 2. Fix the issue on the test branch

Make the fix and commit directly on the test branch:

\`\`\`bash
# ... make fixes ...
git add <files>
git commit -m "fix: ..."
\`\`\`

### 3. Update instrumentation

\`pipeline update\` hoists the instrumentation commit back to HEAD:

\`\`\`bash
pipeline update
\`\`\`

If the parent branch has new commits you need to incorporate:

\`\`\`bash
pipeline disable    # strip instrumentation
git rebase <parent-branch>
pipeline update     # re-apply instrumentation
\`\`\`

### 4. Force push and re-run

\`\`\`bash
git push --force-with-lease
\`\`\`

For PR-triggered workflows, the push automatically triggers a new run. For
push-triggered workflows, dispatch again:

\`\`\`bash
gh workflow run <workflow>.yml --ref <branch>-test-ci
\`\`\`

### 5. Watch and repeat

\`\`\`bash
gh run watch
\`\`\`

If it fails again, go back to step 1.

## Reusable Workflows

If your target job lives in a workflow invoked by another via
\`uses: ./.github/workflows/<name>.yml\`, pipeline walks *up* through that
boundary: it keeps the calling job and the calling job's own \`needs:\` enabled,
because a called workflow's jobs only run when its caller runs. The called
workflow is also reduced to a \`workflow_call\` trigger, so it does not
additionally fire standalone with every \`inputs.*\` empty.

Two things to know:

- Jobs gated on \`inputs.*\` still depend on what the caller passes in
  \`with:\`, which usually derives from the branch's diff. Pipeline warns about
  these — the job will skip unless your branch actually touches the paths the
  caller keys off.
- Run \`gh workflow run\` against the *calling* workflow, not the called one.
  Pipeline's printed command already picks the right file.

## Cleanup

Once your workflow passes, grab the test PR link for reference, then clean up:

\`\`\`bash
gh pr view --json url -q '.url'
pipeline cleanup
\`\`\`

This switches back to the parent branch, deletes the test branch locally and
on the remote, and closes any associated PR. Include the test PR link in your
actual PR description as proof that CI passed.

## Quick Reference

| Step | Command |
|------|---------|
| List jobs | \`pipeline list\` |
| Enable jobs | \`pipeline enable <wf>:<job>\` |
| Show current state | \`pipeline show\` |
| Update after rebase | \`pipeline update\` |
| Strip instrumentation | \`pipeline disable\` |
| Get test PR link | \`gh pr view --json url -q '.url'\` |
| Cleanup test branch | \`pipeline cleanup\` |
| Watch run | \`gh run watch\` |
| View failed logs | \`gh run view <id> --log-failed\` |

## Tips

- Use \`pipeline show\` at any time on the test branch to see the current
  instrumentation and suggested commands
- \`--keep-labels\` flag on \`enable\`/\`update\` preserves label-based conditions
  if you need them
- The printed \`gh pr create\` always carries \`--label run-ci\` so CI opts in on
  repos that gate on that label; \`--pr-label <label...>\` on
  \`enable\`/\`update\`/\`show\` adds more, and \`--no-run-ci-label\` drops the
  default for repos that have no \`run-ci\` label
- Read the \`⚠\` warnings \`enable\` prints: they cover the cases where a run
  comes back green because nothing actually ran
- The test branch is always named \`<parent>-test-ci\`
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
