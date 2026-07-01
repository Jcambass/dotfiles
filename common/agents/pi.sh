# --- Pi launcher -------------------------------------------------------------
# Run Pi natively on macOS, bp-dev, and Codespaces.
# Interactive invocations open or reattach a tmux session so Pi has a stable TUI.
# Set PI_NO_TMUX=1 to run interactive Pi directly.
# Note: this file is sourced by both zsh and bash, so keep it portable.

__pi_dotfiles_system_type() {
  if [ -n "${DOTFILE_SYSTEM_TYPE:-}" ]; then
    printf '%s' "$DOTFILE_SYSTEM_TYPE"
    return
  fi

  if [ -n "${DOTFILES_ROOT:-}" ] && [ -f "$DOTFILES_ROOT/.system" ]; then
    head -n 1 "$DOTFILES_ROOT/.system" 2>/dev/null
    return
  fi

  if [ "${CODESPACES:-}" = "true" ] || [ -n "${CODESPACE_NAME:-}" ]; then
    printf '%s' codespaces
    return
  fi

  if hostname 2>/dev/null | grep -Eq 'bpdev-us-east-1\.github\.net|\.octoca\.ts\.net$'; then
    printf '%s' bpdev
    return
  fi

  printf '%s' unknown
}

__pi_should_run_directly() {
  case "${1:-}" in
    -h|--help|-v|--version|-p|--print|--export|--list-models|config|install|remove|uninstall|update|list)
      return 0
      ;;
  esac

  return 1
}

__pi_default_tmux_session_name() {
  case "$(__pi_dotfiles_system_type)" in
    macos) printf '%s' pi-macos ;;
    codespaces) printf '%s' pi-codespace ;;
    bpdev) printf '%s' pi-bpdev ;;
    *) printf '%s' pi ;;
  esac
}

# Reattach to the existing Pi tmux session when one already exists.
# Run short-lived/non-interactive pi commands directly so tmux doesn't briefly
# attach and leak terminal probe replies back into the parent shell.
pi() {
  if [ -n "${TMUX:-}" ] \
    || [ -n "${PI_NO_TMUX:-}" ] \
    || ! command -v tmux >/dev/null 2>&1 \
    || [ ! -t 0 ] \
    || [ ! -t 1 ] \
    || __pi_should_run_directly "${1:-}"; then
    command pi "$@"
    return
  fi

  local session_name="${PI_TMUX_SESSION_NAME:-$(__pi_default_tmux_session_name)}"
  local pi_command="exec pi"
  local arg
  for arg in "$@"; do
    pi_command="${pi_command} $(printf '%q' "$arg")"
  done

  if command tmux has-session -t "$session_name" 2>/dev/null; then
    command tmux attach-session -t "$session_name"
    return
  fi

  local interactive_shell="sh"
  if [ -n "${ZSH_VERSION:-}" ]; then
    interactive_shell="zsh"
  elif [ -n "${BASH_VERSION:-}" ]; then
    interactive_shell="bash"
  fi

  command tmux new-session -s "$session_name" -c "$PWD" "$interactive_shell -ic $(printf '%q' "$pi_command")"
}
