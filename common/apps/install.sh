#!/usr/bin/env bash

_apps_warnings=()
_apps_linked_count=0
_apps_already_linked_count=0
_apps_skipped_count=0
_apps_overwritten_count=0
_apps_backed_up_count=0

_apps_supports_color() {
  [ -t 2 ] && [ -z "${NO_COLOR:-}" ]
}

_apps_log() {
  printf '  [ apps ] %s\n' "$*"
}

_apps_warn() {
  local message="$*"
  _apps_warnings+=("$message")

  if _apps_supports_color; then
    printf '  [ \033[00;33mapps\033[0m ] \033[00;33mwarning:\033[0m %s\n' "$message" >&2
  else
    printf '  [ apps ] warning: %s\n' "$message" >&2
  fi
}

_apps_print_summary() {
  local warning count
  count="${#_apps_warnings[@]}"

  _apps_log "config summary: ${_apps_linked_count} linked, ${_apps_already_linked_count} already linked, ${_apps_skipped_count} skipped, ${_apps_overwritten_count} overwritten, ${_apps_backed_up_count} backed up"

  if [ "$count" -eq 0 ]; then
    return 0
  fi

  if _apps_supports_color; then
    printf '  [ \033[00;33mapps\033[0m ] \033[00;33m%d warning(s)\033[0m during app config setup:\n' "$count" >&2
  else
    printf '  [ apps ] %d warning(s) during app config setup:\n' "$count" >&2
  fi

  for warning in "${_apps_warnings[@]}"; do
    printf '    - %s\n' "$warning" >&2
  done
}

_apps_root() {
  if [ -n "${DOTFILES_ROOT:-}" ]; then
    printf '%s\n' "$DOTFILES_ROOT"
    return
  fi

  if [ -n "${BASH_SOURCE[0]:-}" ]; then
    (cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd -P)
    return
  fi

  pwd -P
}

_apps_system_type() {
  if [ -n "${DOTFILE_SYSTEM_TYPE:-}" ]; then
    printf '%s\n' "$DOTFILE_SYSTEM_TYPE"
    return
  fi

  local root
  root="$(_apps_root)"
  if [ -f "$root/.system" ]; then
    head -n 1 "$root/.system" 2>/dev/null
    return
  fi

  printf '%s\n' unknown
}

_apps_realpath() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null
    return
  fi

  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null
    return
  fi

  printf '%s\n' "$1"
}

_apps_same_path() {
  [ "$(_apps_realpath "$1" 2>/dev/null)" = "$(_apps_realpath "$2" 2>/dev/null)" ]
}

_apps_backup_path() {
  local dest="$1" backup="${dest}.backup"

  if [ ! -e "$backup" ] && [ ! -L "$backup" ]; then
    printf '%s\n' "$backup"
    return
  fi

  printf '%s\n' "${backup}.$(date +%Y%m%d%H%M%S)"
}

_apps_enable_cmux_beta_features() {
  command -v defaults >/dev/null 2>&1 || return 0

  defaults write com.cmuxterm.app rightSidebar.beta.feed.enabled -bool true || _apps_warn "could not enable cmux Feed beta"
  defaults write com.cmuxterm.app rightSidebar.beta.dock.enabled -bool true || _apps_warn "could not enable cmux Dock beta"
  defaults write com.cmuxterm.app extensions.beta.enabled -bool true || _apps_warn "could not enable cmux Extensions beta"
  defaults write com.cmuxterm.app customSidebars.beta.enabled -bool true || _apps_warn "could not enable cmux Custom Sidebars beta"
  defaults write com.cmuxterm.app remoteTmux.beta.enabled -bool true || _apps_warn "could not enable cmux Remote tmux beta"
}

_apps_link_file() {
  local src="$1" dest="$2" backup

  [ -f "$src" ] || return 0

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ -L "$dest" ] && _apps_same_path "$dest" "$src"; then
      _apps_already_linked_count=$((_apps_already_linked_count + 1))
      return 0
    fi

    if [ -n "${DOTFILES_OVERWRITE_CONFLICTS:-}" ]; then
      rm -rf "$dest" || return 1
      _apps_overwritten_count=$((_apps_overwritten_count + 1))
    elif [ -n "${DOTFILES_BACKUP_CONFLICTS:-}" ]; then
      backup="$(_apps_backup_path "$dest")"
      mv "$dest" "$backup" || return 1
      _apps_backed_up_count=$((_apps_backed_up_count + 1))
      _apps_log "moved $dest to $backup"
    else
      _apps_skipped_count=$((_apps_skipped_count + 1))
      _apps_warn "skipped $dest; exists and is not linked to $src"
      return 0
    fi
  fi

  mkdir -p "$(dirname "$dest")" || return 1
  ln -s "$src" "$dest" && _apps_linked_count=$((_apps_linked_count + 1)) && _apps_log "linked $dest -> $src"
}

_apps_main() {
  local root system failures=0
  root="$(_apps_root)"
  system="$(_apps_system_type)"

  _apps_link_file "$root/common/apps/config/htop/htoprc" "$HOME/.config/htop/htoprc" || failures=$((failures + 1))
  _apps_link_file "$root/common/apps/gemrc" "$HOME/.gemrc" || failures=$((failures + 1))

  if [ "$system" = "macos" ]; then
    _apps_link_file "$root/common/apps/config/ghostty/config" "$HOME/.config/ghostty/config" || failures=$((failures + 1))
    _apps_link_file "$root/common/apps/config/cmux/dock.json" "$HOME/.config/cmux/dock.json" || failures=$((failures + 1))
    _apps_enable_cmux_beta_features
  fi

  if [ "$failures" -gt 0 ]; then
    _apps_warn "completed with $failures non-fatal issue(s)"
  fi

  _apps_print_summary
}

_apps_main "$@"
