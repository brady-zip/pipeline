import { Command } from "commander";

const BASH_COMPLETION = `
_pipeline_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local prev="\${COMP_WORDS[COMP_CWORD-1]}"

    case "\${COMP_WORDS[1]}" in
        enable)
            COMPREPLY=( $(compgen -W "$(pipeline list 2>/dev/null)" -- "$cur") )
            return 0
            ;;
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
            return 0
            ;;
        *)
            if [[ \${COMP_CWORD} -eq 1 ]]; then
                COMPREPLY=( $(compgen -W "enable list completion" -- "$cur") )
            fi
            ;;
    esac
}

complete -F _pipeline_completions pipeline
`.trim();

const ZSH_COMPLETION = `
#compdef pipeline

_pipeline() {
    local line state

    _arguments -C \\
        "1: :->command" \\
        "*::arg:->args"

    case "$state" in
        command)
            _values "command" \\
                "enable[Enable jobs and dependencies, disable others]" \\
                "list[List all jobs]" \\
                "completion[Generate shell completion script]"
            ;;
        args)
            case $line[1] in
                enable)
                    _values "jobs" \${(f)"$(pipeline list 2>/dev/null)"}
                    ;;
                completion)
                    _values "shell" bash zsh fish
                    ;;
            esac
            ;;
    esac
}

_pipeline
`.trim();

const FISH_COMPLETION = `
complete -c pipeline -f

complete -c pipeline -n "__fish_use_subcommand" -a "enable" -d "Enable jobs and dependencies, disable others"
complete -c pipeline -n "__fish_use_subcommand" -a "list" -d "List all jobs"
complete -c pipeline -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion script"

complete -c pipeline -n "__fish_seen_subcommand_from enable" -a "(pipeline list 2>/dev/null)"
complete -c pipeline -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"
`.trim();

export const completionCommand = new Command("completion")
  .description("Generate shell completion script")
  .argument("<shell>", "Shell type (bash/zsh/fish)")
  .action((shell: string) => {
    switch (shell) {
      case "bash":
        console.log(BASH_COMPLETION);
        break;
      case "zsh":
        console.log(ZSH_COMPLETION);
        break;
      case "fish":
        console.log(FISH_COMPLETION);
        break;
      default:
        console.error(`Unknown shell: ${shell}`);
        console.error("Supported shells: bash, zsh, fish");
        process.exit(1);
    }
  });
