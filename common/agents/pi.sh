# --- Pi launcher -------------------------------------------------------------
# Run Pi natively on macOS, bp-dev, and Codespaces.
#
# This file is sourced by both zsh and bash, so keep it portable. Interactive
# sessions use cmux directly when already inside cmux, use the current tmux pane
# when already inside tmux, and otherwise start a small tmux wrapper when tmux is
# available. Short-lived commands run directly so they stay pipeable.

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

  if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    printf '%s' macos
    return
  fi

  if hostname 2>/dev/null | grep -Eq 'bpdev-us-east-1\.github\.net|\.octoca\.ts\.net$'; then
    printf '%s' bpdev
    return
  fi

  printf '%s' unknown
}

__pi_is_codespaces() {
  [ "$(__pi_dotfiles_system_type)" = "codespaces" ]
}

__pi_is_bpdev() {
  [ "$(__pi_dotfiles_system_type)" = "bpdev" ]
}

__pi_is_macos() {
  [ "$(__pi_dotfiles_system_type)" = "macos" ]
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
  if __pi_is_codespaces; then
    printf '%s' pi-codespace
  elif __pi_is_bpdev; then
    printf '%s' pi-bpdev
  elif __pi_is_macos; then
    printf '%s' pi-macos
  else
    printf '%s' pi
  fi
}

__pi_current_shell() {
  if [ -n "${ZSH_VERSION:-}" ]; then
    printf '%s' zsh
  elif [ -n "${BASH_VERSION:-}" ]; then
    printf '%s' bash
  else
    printf '%s' sh
  fi
}

__pi_run_native() {
  export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.local}"

  if [ -n "${CMUX_WORKSPACE_ID:-}" ] \
    || [ -n "${TMUX:-}" ] \
    || ! command -v tmux >/dev/null 2>&1 \
    || [ ! -t 0 ] \
    || [ ! -t 1 ] \
    || __pi_should_run_directly "${1:-}"; then
    command pi "$@"
    return
  fi

  local session_name="${PI_TMUX_SESSION_NAME:-$(__pi_default_tmux_session_name)}"
  if command tmux has-session -t "$session_name" 2>/dev/null; then
    command tmux attach-session -t "$session_name"
    return
  fi

  local pi_command="exec pi"
  local arg
  for arg in "$@"; do
    pi_command="$pi_command $(printf '%q' "$arg")"
  done

  local interactive_shell
  interactive_shell="$(__pi_current_shell)"
  command tmux new-session -s "$session_name" -c "$PWD" "$interactive_shell -ic $(printf '%q' "$pi_command")"
}

pi() {
  __pi_run_native "$@"
}
