#!/bin/sh
#
# Homebrew
#
# This installs some of the common dependencies needed (or at least desired)
# using Homebrew.

# Check for Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "  Installing Homebrew for you."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if command -v brew >/dev/null 2>&1; then
  missing_brews=""
  command -v git >/dev/null 2>&1 || missing_brews="$missing_brews git"
  command -v gh >/dev/null 2>&1 || missing_brews="$missing_brews gh"
  command -v jq >/dev/null 2>&1 || missing_brews="$missing_brews jq"
  command -v rg >/dev/null 2>&1 || missing_brews="$missing_brews ripgrep"
  command -v tmux >/dev/null 2>&1 || missing_brews="$missing_brews tmux"
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
  brew install --cask cmux
fi

if ! command -v docker >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  echo "  Installing OrbStack for docker-pi."
  brew install --cask orbstack
fi

return 0 2>/dev/null || exit 0
