/**
 * Applied to every test PR pipeline prints. Repos commonly gate CI behind an
 * opt-in label, and a test PR that silently skips every job is the single
 * most confusing failure mode, so the label goes on by default rather than
 * waiting to be asked for. `--no-run-ci-label` drops it for repos that have
 * no such label (`gh pr create` errors on a label the repo does not define).
 */
export const DEFAULT_PR_LABEL = "run-ci";

export interface PRCreateOptions {
  /** Extra labels from `--pr-label`, on top of the default. */
  prLabels?: string[];
  /** False when `--no-run-ci-label` was passed. */
  includeDefaultLabel?: boolean;
}

/**
 * The `gh pr create` invocation printed by enable/update/show. Shared so the
 * three commands cannot drift apart.
 */
export function effectivePRLabels(options: PRCreateOptions = {}): string[] {
  const { prLabels = [], includeDefaultLabel = true } = options;
  return [
    ...(includeDefaultLabel ? [DEFAULT_PR_LABEL] : []),
    ...prLabels,
  ].filter((label, index, all) => all.indexOf(label) === index);
}

export function prCreateLines(options: PRCreateOptions = {}): string[] {
  const labelArgs = effectivePRLabels(options)
    .map((label) => ` --label ${label}`)
    .join("");
  return [
    "  REPO_ID=$(git remote get-url origin | sed 's/.*github.com[:\\/]\\(.*\\).git/\\1/')",
    `  gh pr create --draft --title "$(git log -1 --format=%s)" --body "$(git log -1 --format=%b)"${labelArgs} --repo $REPO_ID`,
  ];
}

/**
 * The `gh workflow run` one-liner printed by enable/update/show.
 *
 * A called workflow is `workflow_call`-only after instrumentation, so
 * dispatching it directly is rejected — the run has to start from a workflow
 * that still owns a trigger. If none of the workflows in play owns one, say so
 * rather than printing a command that cannot succeed.
 */
export function dispatchLines(
  workflowsToRun: Set<string>,
  calledWorkflows: Set<string>,
  ref: string,
): string[] {
  const dispatchable = [...workflowsToRun].find(
    (workflow) => !calledWorkflows.has(workflow),
  );

  if (!dispatchable) {
    return [
      "  # No enabled workflow has a trigger of its own — every one of them is",
      "  # reached only via `uses:`, so there is nothing to dispatch. Open a PR",
      "  # on this branch instead, or enable a job in the calling workflow.",
    ];
  }

  const file = `${dispatchable}.yml`;
  return [
    `  gh workflow run ${file} --ref ${ref} && sleep 2 && gh run watch $(gh run list --workflow=${file} --limit 1 --json databaseId -q '.[0].databaseId') && osascript -e 'display notification "Workflow complete" with title "pipeline"'`,
  ];
}
