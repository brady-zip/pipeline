import { Command } from "commander";

const BASH_COMPLETION = `
_pipeline_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"

    case "\${COMP_WORDS[1]}" in
        enable)
            # Get full token handling : in COMP_WORDBREAKS
            local token="\${COMP_LINE:0:$COMP_POINT}"
            token="\${token##* }"

            local all_jobs=$(pipeline list 2>/dev/null)
            if [[ "$token" == *:* ]]; then
                COMPREPLY=( $(compgen -W "$all_jobs" -- "$token") )
                __ltrim_colon_completions "$token" 2>/dev/null
            else
                compopt -o nospace 2>/dev/null
                local workflows=$(echo "$all_jobs" | cut -d: -f1 | sort -u)
                COMPREPLY=( $(compgen -W "$(for w in $workflows; do echo "\${w}:"; done)" -- "$token") )
            fi
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
                    if compset -P '*:'; then
                        local workflow="\${IPREFIX%:}"
                        local jobs=(\${(f)"$(pipeline list 2>/dev/null | grep "^\${workflow}:" | cut -d: -f2-)"})
                        _describe "job" jobs
                    else
                        local workflows=(\${(f)"$(pipeline list 2>/dev/null | cut -d: -f1 | sort -u)"})
                        _describe "workflow" workflows -S ':'
                    fi
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

# Workflow-then-job completion: show workflows first, full keys after :
complete -c pipeline -n "__fish_seen_subcommand_from enable; and not string match -q '*:*' (commandline -ct)" -a "(pipeline list 2>/dev/null | string replace -r ':.*' '' | sort -u)" -f
complete -c pipeline -n "__fish_seen_subcommand_from enable; and string match -q '*:*' (commandline -ct)" -a "(pipeline list 2>/dev/null)" -f
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
