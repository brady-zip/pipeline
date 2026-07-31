# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pipeline` is a CLI that selectively enables GitHub Actions jobs for isolated testing. It rewrites the `.github/workflows/*.yml` files in _whatever repo you run it in_ so that only the jobs you care about (plus their transitive dependencies) run, commits that rewrite as an instrumentation commit on a throwaway `-test-ci` branch, and squashes everything back when you're done. The tool operates on the host repo's workflows at runtime — it is not about this repo's own CI.

## Commands

This project runs on **Bun** (uses `bun build --compile` and Bun's `$` shell API), even though `npm install` is used in release CI.

```bash
bun install              # install deps
bun run build            # compile a standalone binary to bin/pipeline
bun run typecheck        # tsc --noEmit (the real "did it compile" check)
bun run dev              # tsc --watch (emits to dist/)
oxlint -c oxlint.json    # lint (also runs on staged files via lint-staged)
prettier --write .       # format
```

There is **no test suite** — no test runner is configured. Verification is `bun run typecheck` plus manual exercise of the CLI. Don't claim tests pass; there are none.

Run the CLI locally without compiling: `bun run src/index.ts <command>`.

## Commit conventions (enforced)

Husky hooks enforce a strict flow — be aware when committing:

- **commit-msg**: commitlint with `@commitlint/config-conventional`. Messages must be conventional (`feat:`, `fix:`, `chore:`, etc.).
- **pre-commit**: `lint-staged` (oxlint + prettier on staged files) then `bun run typecheck`. A type error blocks the commit.
- **post-commit**: `scripts/auto-version.sh` auto-bumps the version (see below).

`fix:` / `feat:` commits trigger a version bump; `chore:` and `refactor:` do not. Add `[skip-version]` to a commit message to suppress the bump.

## Auto-versioning

`scripts/auto-version.sh` runs after every commit. It asks an LLM (`uvx llm -m gpt-4o-mini`) to classify the last diff as MAJOR/MINOR/PATCH, bumps `package.json`, rebuilds, commits `chore: bump to vX.Y.Z [skip-version]`, and creates a `vX.Y.Z` git tag. Pushing a `v*` tag triggers `.github/workflows/release.yml`, which compiles `pipeline-darwin-arm64` and publishes a GitHub release. The install script and self-updater both pull that asset from the `brady-zip/pipeline` repo.

## Architecture

The CLI (`src/index.ts`) wires up Commander subcommands and runs a best-effort self-update check before parsing args. Each subcommand lives in `src/commands/` and composes a shared pipeline of pure-ish library modules in `src/lib/`:

```
parseWorkflows (parser.ts)   read .github/workflows/*.yml → Map<name, Workflow>
        ↓
buildDependencyGraph (graph.ts)   flatten jobs, resolve needs + reusable-workflow
        ↓                         wildcards (workflow:*), detect cycles
getRequiredJobs(targets)     transitive closure of jobs to keep enabled
        ↓
modifyWorkflows (modifier.ts)   rewrite YAML: strip `if` on enabled jobs,
                                add `if: false` to disabled jobs, swap triggers
```

Key concepts to understand before editing:

- **Job keys** are `workflow:job` strings (see `types.ts` `makeJobKey`/`parseJobKey`). The workflow name is the filename without `.yml`. This format is the lingua franca across every module.
- **Dependency resolution** happens in two places: `parser.ts` records local `needs` and reusable-workflow `uses` as `reusedWorkflow:*` placeholders; `graph.ts` expands those `:*` wildcards into concrete job keys and then walks the graph for cycles/missing deps.
- **YAML rewriting uses two different parsers on purpose**: `parser.ts` uses `yaml`'s plain `parse()` (data only, for the graph), while `modifier.ts` uses `parseDocument()` to preserve formatting/comments when writing files back. When changing how workflows are read vs. written, keep that split.
- **PR-context detection** (`detector.ts`): if an enabled job's `if` or its workflow's triggers reference PR context (`github.event.pull_request`, `pull_request`, etc.), `modifier.ts` rewrites triggers to `pull_request` instead of `push`, and `enable`/`update` print `gh pr create` instructions instead of `gh workflow run`. PR-context and (optionally) label conditions are _preserved_ rather than stripped — see `removeIfCondition`.
- **`cleanWorkflowDocument`** strips any top-level workflow key not in `VALID_WORKFLOW_KEYS`. If you add support for a new top-level key, add it there or it will be silently deleted on rewrite.

### Branch / commit state machine (`src/lib/branch.ts`)

The whole instrumentation lifecycle is encoded in git, not in any state file:

- Test branches are `<parent>-test-ci` (`TEST_BRANCH_SUFFIX`).
- The instrumentation commit is identified by its message starting with `### DO NOT MERGE` (`ENABLE_COMMIT_MARKER`), and the enabled jobs are parsed back out of the `Test CI for jobs: ...` line.
- `enable` requires being on a non-test branch with no existing instrumentation; `update` requires a test branch and _hoists_ the instrumentation commit back to HEAD (via `rebase --onto` + `cherry-pick`) before re-applying; `disable` removes it with `rebase --onto`; `cleanup` squash-merges everything except `.github/` back to the parent and deletes the test branch.

Commands shell out to `git`/`gh` heavily through Bun's `$`. Many commands _print_ git/gh commands for the user to run rather than executing them (the actual branch creation and pushing is left to the user) — preserve that pattern when adding output.

### Config & self-update

`config.ts` reads `~/.config/pipeline/config.toml` (hand-rolled minimal TOML parsing — only `auto_update` and `pinned_version`). `updater.ts` checks GitHub releases at most hourly, downloads the pinned-or-latest `pipeline-darwin-arm64`, and atomically replaces the running binary (`process.execPath`). Both are intentionally silent on failure.

## Conventions

- ESM with `"module": "NodeNext"`: **relative imports must use `.js` extensions** even though the source is `.ts` (e.g. `import { ... } from "../lib/parser.js"`). `strict` TypeScript is on.
- The `skill` command (`src/commands/skill.ts`) embeds a long markdown guide as a string constant; the test-branch suffix and command names in that guide must stay in sync with the actual code (there's commit history of fixing drift here).
- Platform support is currently macOS arm64 only (single release asset, `xattr` quarantine removal in the installer).
