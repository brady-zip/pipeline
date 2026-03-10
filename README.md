# pipeline

CLI tool to selectively enable GitHub Actions jobs for isolated testing. Instruments workflow files so only the jobs you care about run on a test branch, then cleans up when you're done.

## Installation

Requires [gh CLI](https://cli.github.com) authenticated with `gh auth login`.

```bash
# Install latest release
curl -fsSL https://raw.githubusercontent.com/brady-zip/pipeline/main/scripts/install.sh | bash

# Install a specific version
curl -fsSL https://raw.githubusercontent.com/brady-zip/pipeline/main/scripts/install.sh | bash -s v1.10.0
```

The binary is installed to `~/.local/bin/pipeline`. Make sure it's in your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

A default config is created at `~/.config/pipeline/config.toml` with auto-update enabled.

## Usage

### List available jobs

```bash
pipeline list
```

Shows all jobs across your workflow files in `workflow:job` format.

### Enable jobs for testing

```bash
pipeline enable <workflow:job> [workflow:job...]
```

Instruments workflow files to only run the specified jobs (and their dependencies), then creates a test branch. Push the branch to trigger the enabled jobs.

Use `--keep-labels` to preserve label-based conditions on jobs.

### Update after rebase

```bash
pipeline update
```

Re-applies instrumentation after rebasing your test branch. Useful when the base branch has workflow changes.

### Show current state

```bash
pipeline show
```

Shows the test and cleanup steps for the current instrumentation.

### Disable instrumentation

```bash
pipeline disable
```

Removes the pipeline instrumentation commit without cleaning up the branch.

### Cleanup

```bash
pipeline cleanup
```

Cleans up the test branch and squashes your changes back to the parent branch. Use `--branch <branch>` to specify a different test branch.

### Shell completions

```bash
# Generate completions for your shell
pipeline completion zsh >> ~/.zshrc
pipeline completion bash >> ~/.bashrc
```

## Updating

Pipeline checks for updates automatically. Configure update behavior in `~/.config/pipeline/config.toml`:

```toml
[updates]
auto_update = true
pinned_version = ""
```

Set `pinned_version` to lock to a specific version (e.g. `"1.10.0"`).
