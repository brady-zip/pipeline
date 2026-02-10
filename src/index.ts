import { Command } from "commander";
import { enableCommand } from "./commands/enable.js";
import { updateCommand } from "./commands/update.js";
import { showCommand } from "./commands/show.js";
import { cleanupCommand } from "./commands/cleanup.js";
import { disableCommand } from "./commands/disable.js";
import { listCommand } from "./commands/list.js";
import { completionCommand } from "./commands/completion.js";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name("pipeline")
  .description(
    "CLI tool to selectively enable GitHub Actions jobs for isolated testing",
  )
  .version(pkg.version);

program.addCommand(enableCommand);
program.addCommand(updateCommand);
program.addCommand(showCommand);
program.addCommand(cleanupCommand);
program.addCommand(disableCommand);
program.addCommand(listCommand);
program.addCommand(completionCommand);

program.parse();
