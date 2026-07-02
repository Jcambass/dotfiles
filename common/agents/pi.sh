# --- Pi launcher -------------------------------------------------------------
# Run Pi natively everywhere. Interactive sessions are wrapped in tmux by
# default so Pi gets a stable terminal surface without a container.
#
# This file is sourced by both zsh and bash, so keep it portable.

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

  if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    printf '%s' macos
    return
  fi

  printf '%s' native
}

__pi_real_command() {
  if [ -n "${PI_BINARY:-}" ] && [ -x "$PI_BINARY" ]; then
    printf '%s\n' "$PI_BINARY"
    return
  fi

  if [ -n "${ZSH_VERSION:-}" ] && command -v whence >/dev/null 2>&1; then
    whence -p pi 2>/dev/null && return
  fi

  if [ -n "${BASH_VERSION:-}" ] && type -P pi >/dev/null 2>&1; then
    type -P pi
    return
  fi

  command -v pi 2>/dev/null
}

__pi_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

__pi_should_run_directly() {
  case "${1:-}" in
    -h|--help|-v|--version|-p|--print|--export|--list-models|config|install|remove|uninstall|update|list)
      return 0
      ;;
  esac

  return 1
}

__pi_default_session_name() {
  case "$(__pi_dotfiles_system_type)" in
    macos) printf '%s\n' pi-macos ;;
    bpdev) printf '%s\n' pi-bpdev ;;
    codespaces) printf '%s\n' pi-codespace ;;
    *) printf '%s\n' pi ;;
  esac
}

__pi_interactive_shell() {
  if [ -n "${ZSH_VERSION:-}" ]; then
    printf '%s\n' zsh
  elif [ -n "${BASH_VERSION:-}" ]; then
    printf '%s\n' bash
  else
    printf '%s\n' sh
  fi
}

pi() {
  local pi_bin session_name pi_command arg interactive_shell
  pi_bin="$(__pi_real_command)"
  if [ -z "$pi_bin" ]; then
    printf 'pi: native pi binary not found on PATH\n' >&2
    return 127
  fi

  if [ -n "${PI_NO_TMUX:-}" ] \
    || [ -n "${TMUX:-}" ] \
    || ! command -v tmux >/dev/null 2>&1 \
    || [ ! -t 0 ] \
    || [ ! -t 1 ] \
    || __pi_should_run_directly "${1:-}"; then
    "$pi_bin" "$@"
    return
  fi

  session_name="${PI_TMUX_SESSION_NAME:-$(__pi_default_session_name)}"
  if command tmux has-session -t "$session_name" 2>/dev/null; then
    command tmux attach-session -t "$session_name"
    return
  fi

  pi_command="exec $(__pi_quote "$pi_bin")"
  for arg in "$@"; do
    pi_command="${pi_command} $(__pi_quote "$arg")"
  done

  interactive_shell="$(__pi_interactive_shell)"
  command tmux new-session -s "$session_name" -c "$PWD" "$interactive_shell -ic $(__pi_quote "$pi_command")"
}
