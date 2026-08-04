#!/usr/bin/env bash
#
# Runs script/external-repos-sync as part of bootstrap. See
# common/external-repos/repos.conf for the manifest format,
# script/external-repos-sync for the clone/update logic, and AGENTS.md's
# "External repo linking model" section for the full design.
#
# This must never fail bootstrap: some or all listed repos may be
# inaccessible from this machine (private/internal repos this account
# can't see, no network, etc.) -- an expected, silent outcome, not every
# machine needs every external repo. script/bootstrap treats any non-zero
# exit from a topic's install.sh as a hard failure for the whole run, so
# this wrapper always exits 0 regardless of what the sync script reports.

set -u

if [ -n "${DOTFILES_SKIP_EXTERNAL_REPOS_SYNC:-}" ]; then
  echo "  [ external-repos ] skipping (DOTFILES_SKIP_EXTERNAL_REPOS_SYNC set)"
  exit 0
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
"$root/script/external-repos-sync" || true
exit 0
