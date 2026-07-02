#!/bin/sh
#
# Homebrew
#
# This installs some of the common dependencies needed (or at least desired)
# using Homebrew.


trust_homebrew_taps() {
  if [ -n "${DOTFILES_SKIP_HOMEBREW_TRUST:-}" ]; then
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1 || ! brew trust --help >/dev/null 2>&1; then
    return 0
  fi

  for tap in github/bootstrap jcambass/tailhopper jcambass/tap manaflow-ai/cmux; do
    if brew tap | grep -qx "$tap"; then
      brew trust "$tap" >/dev/null 2>&1 || echo "  Warning: could not trust Homebrew tap $tap; continuing"
    fi
  done
}

has_modern_bash() {
  for bash_bin in /opt/homebrew/bin/bash /usr/local/bin/bash bash; do
    command -v "$bash_bin" >/dev/null 2>&1 || continue
    "$bash_bin" -c '[ "${BASH_VERSINFO[0]}" -ge 4 ]' >/dev/null 2>&1 && return 0
  done

  return 1
}

# Check for Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "  Installing Homebrew for you."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if command -v brew >/dev/null 2>&1; then
  trust_homebrew_taps

  missing_brews=""
  command -v git >/dev/null 2>&1 || missing_brews="$missing_brews git"
  command -v gh >/dev/null 2>&1 || missing_brews="$missing_brews gh"
  command -v jq >/dev/null 2>&1 || missing_brews="$missing_brews jq"
  command -v rg >/dev/null 2>&1 || missing_brews="$missing_brews ripgrep"
  command -v tmux >/dev/null 2>&1 || missing_brews="$missing_brews tmux"
  has_modern_bash || missing_brews="$missing_brews bash"
  command -v npm >/dev/null 2>&1 || missing_brews="$missing_brews node"
  command -v opencode >/dev/null 2>&1 || missing_brews="$missing_brews opencode"
  command -v pup >/dev/null 2>&1 || missing_brews="$missing_brews pup"

  if [ -n "$missing_brews" ]; then
    echo "  Installing agent toolchain with Homebrew."
    brew install $missing_brews
  fi
fi

if ! command -v cmux >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  echo "  Installing cmux for agent workspaces."
  brew tap manaflow-ai/cmux
  trust_homebrew_taps
  brew install --cask cmux
fi

if ! command -v ghostty >/dev/null 2>&1 \
  && [ ! -d /Applications/Ghostty.app ] \
  && [ ! -d "$HOME/Applications/Ghostty.app" ] \
  && command -v brew >/dev/null 2>&1; then
  echo "  Installing Ghostty."
  brew install --cask ghostty
fi

unset -f trust_homebrew_taps has_modern_bash

return 0 2>/dev/null || exit 0
