#!/usr/bin/env bash

set -euo pipefail

src="${DOTFILES_ROOT:-$HOME/.dotfiles}/common/vim/vimrc.symlink"
dest="$HOME/.config/nvim/init.vim"

log() { printf '  [ vim ] %s\n' "$*"; }
warn() { printf '  [ vim ] warning: %s\n' "$*" >&2; }

if [ ! -f "$src" ]; then
  warn "missing shared vim config: $src"
  exit 0
fi

mkdir -p "$(dirname "$dest")"

if [ -L "$dest" ]; then
  current="$(readlink "$dest" 2>/dev/null || true)"
  if [ "$current" = "$src" ]; then
    log "$dest already linked"
    exit 0
  fi
  rm "$dest"
elif [ -e "$dest" ]; then
  warn "$dest exists and is not a symlink; leaving it untouched"
  exit 0
fi

ln -s "$src" "$dest"
log "linked $dest -> $src"
