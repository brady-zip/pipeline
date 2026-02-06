import { Command } from "commander";
import { enableCommand } from "./commands/enable.js";
import { listCommand } from "./commands/list.js";
import { completionCommand } from "./commands/completion.js";
const program = new Command();
program
    .name("pipeline")
    .description("CLI tool to selectively enable GitHub Actions jobs for isolated testing")
    .version("0.1.0");
program.addCommand(enableCommand);
program.addCommand(listCommand);
program.addCommand(completionCommand);
program.parse();
