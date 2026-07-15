# Private, internal-only content

This folder is for content that would normally live in this dotfiles repo but
can't, because it depends on non-public systems: internal hostnames, internal
service or database names, company-specific queries, or anything else that
would violate this repo's public-repository boundaries (see root `AGENTS.md`).

**Everything under `private/` is gitignored except this README.** Files placed
here never get committed, never leak to the public remote, and are never at
risk from a stray `git add .` — the `.gitignore` rule covers the whole folder.

## What goes here

- Private config files consumed by generic, committed tooling — e.g. a Pi
  extension that's generic and public, paired with a config file here that
  holds the actual internal cluster/table/query details.
- Anything else internal-only that you want to keep physically next to the
  rest of your dotfiles for discoverability, even though it can't be tracked.

## What doesn't go here

- Machine-local state that's already handled elsewhere: Pi's `auth.json`,
  `trust.json`, `sessions/`, `bin/`, `config/`, `gh/` (see `.gitignore` and
  `common/agents/install.sh`). Those are excluded because they're per-machine,
  not because they're private — don't duplicate that handling here.
- Secrets or tokens that need actual encryption at rest. This folder is a
  gitignore boundary, not a secrets manager. Use a real secrets tool if that's
  what you need.

## Layout

Organize by topic, same spirit as the rest of the repo:

```
private/
  pi/
    kusto-commands.json   # consumed by .pi/agent/extensions/kusto-command.ts
```

## Wiring it up

Point the consuming tool at a file here, then symlink (or point an env var)
from the tool's expected local config path back into `private/`. For example:

```sh
ln -sf "$PWD/private/pi/kusto-commands.json" ~/.config/pi/kusto-commands.json
```

This keeps the per-file symlink convention used throughout the repo: real
content lives in one place, consumption points are symlinks or env vars, and
git never has to choose between "all public" or "all private" for a single
directory.

## Multi-machine note

This folder is gitignored, so it does **not** sync across machines the way
the rest of the repo does via `git pull`. If you need the same private
content on multiple machines, you'll need a separate sync mechanism (a second
private git remote for just this folder, a synced cloud folder, or manual
copy) — this README and `.gitignore` rule only guarantee it never becomes
public.
