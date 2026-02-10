import { $ } from "bun";
import { Command } from "commander";
import { TEST_BRANCH_SUFFIX, findInstrumentedCommit } from "../lib/branch.js";

export const disableCommand = new Command("disable")
  .description("Remove pipeline instrumentation commit")
  .action(async () => {
    const currentBranch = (
      await $`git rev-parse --abbrev-ref HEAD`.text()
    ).trim();

    if (!currentBranch.endsWith(TEST_BRANCH_SUFFIX)) {
      console.error("Error: Not on a test branch (must end with -test-ci)");
      process.exit(1);
    }

    const instrumentedCommit = await findInstrumentedCommit();

    if (!instrumentedCommit) {
      console.error("Error: No instrumented commit found in history");
      process.exit(1);
    }

    console.log(
      `Removing instrumented commit ${instrumentedCommit.slice(0, 7)}...`,
    );

    const result =
      await $`git rebase --onto ${instrumentedCommit}^ ${instrumentedCommit}`.nothrow();
    if (result.exitCode === 0) {
      console.log("✓ Instrumentation removed");
      console.log("");
      console.log(
        "You can now rebase/fix conflicts, then run 'pipeline update' again.",
      );
    } else {
      console.error(
        "Error: Rebase failed. Resolve conflicts with 'git rebase --continue'",
      );
      process.exit(1);
    }
  });
