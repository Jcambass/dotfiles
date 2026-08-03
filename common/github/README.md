# github

Small cross-platform CLI helpers built on top of `gh`. No extra dependencies
beyond `gh` itself (Python 3 stdlib only, no external `jq`).

## `pr-watch`

Lightweight PR monitor: watches a set of PRs (any repo, any owner) and
re-renders a compact table every N seconds showing repo, number, title, CI
status, review status, and state. Built as a plain-terminal alternative to
`gh dash` for the common case of "just keep an eye on these specific PRs".

```
pr-watch                        watch the persisted list
pr-watch <ref> [<ref> ...]      watch these PRs (not persisted)
pr-watch --add <ref> [...]      add ref(s) to the persisted list
pr-watch --remove <ref> [...]   remove ref(s) from the persisted list
pr-watch --list                 print the persisted list and exit
pr-watch --once [<ref> ...]     render once and exit (no loop)
pr-watch --interval 15 ...      refresh interval in seconds (default 30)
pr-watch --json ...             raw JSON instead of a table (for scripting)
```

A ref is one of:

- `https://github.com/owner/repo/pull/123`
- `owner/repo#123`
- `123` (bare number, resolved against the repo in the current directory)

The persisted list lives at `~/.config/pr-watch/list` (one ref per line,
untracked, machine-local).

In pi, `/prs` opens this in a new cmux pane split in the current workspace
rather than a new tab -- see `.pi/agent/extensions/pr-watch.ts`.
