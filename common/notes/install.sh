#!/usr/bin/env bash

_notes_warnings=()

_notes_log() { printf '  [ notes ] %s\n' "$*"; }
_notes_warn() { _notes_warnings+=("$*"); printf '  [ notes ] warning: %s\n' "$*" >&2; }

_notes_system_type() {
  if [ -n "${DOTFILE_SYSTEM_TYPE:-}" ]; then
    printf '%s\n' "$DOTFILE_SYSTEM_TYPE"
  elif [ -n "${DOTFILES_ROOT:-}" ] && [ -f "$DOTFILES_ROOT/.system" ]; then
    head -n 1 "$DOTFILES_ROOT/.system" 2>/dev/null
  else
    printf '%s\n' unknown
  fi
}

_notes_can_brew() { command -v brew >/dev/null 2>&1; }
_notes_can_apt() { command -v sudo >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; }

_notes_brew_install_missing() {
  local packages=() cmd pkg
  for pkg in "$@"; do
    cmd="$pkg"
    [ "$pkg" = "neovim" ] && cmd="nvim"
    command -v "$cmd" >/dev/null 2>&1 || packages+=("$pkg")
  done
  [ "${#packages[@]}" -eq 0 ] && return 0
  if ! _notes_can_brew; then
    _notes_warn "Homebrew unavailable; cannot install: ${packages[*]}"
    return 0
  fi
  _notes_log "installing packages: ${packages[*]}"
  brew install "${packages[@]}" || _notes_warn "brew install failed for: ${packages[*]}"
}

_notes_apt_install_missing() {
  local packages=() cmd pkg
  for pkg in "$@"; do
    cmd="$pkg"
    [ "$pkg" = "neovim" ] && cmd="nvim"
    command -v "$cmd" >/dev/null 2>&1 || packages+=("$pkg")
  done
  [ "${#packages[@]}" -eq 0 ] && return 0
  if ! _notes_can_apt; then
    _notes_warn "sudo or apt-get unavailable; cannot install: ${packages[*]}"
    return 0
  fi
  _notes_log "installing packages: ${packages[*]}"
  sudo apt-get update \
    && sudo apt-get install -y --no-install-recommends "${packages[@]}" \
    || _notes_warn "apt-get install failed for: ${packages[*]}"
}

case "$(_notes_system_type)" in
  macos)
    _notes_brew_install_missing neovim codespell aspell
    ;;
  bpdev|codespaces)
    _notes_apt_install_missing neovim codespell aspell
    ;;
  *)
    _notes_warn "unknown system type; skipping package installation"
    ;;
esac

if [ "${#_notes_warnings[@]}" -gt 0 ]; then
  printf '  [ notes ] %d warning(s):\n' "${#_notes_warnings[@]}" >&2
  for warning in "${_notes_warnings[@]}"; do
    printf '    - %s\n' "$warning" >&2
  done
fi
