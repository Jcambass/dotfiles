# github

Small cross-platform CLI helpers built on top of `gh`.

## `pr-watch`

An interactive PR monitor (Go + Bubble Tea) plus headless flags for
scripting/agent use -- a plain-terminal alternative to `gh dash` for "just
keep an eye on these specific PRs". One tool, no separate scripting-only
implementation.

Source lives in `pr-watch/` (its own Go module). The wrapper at
`bin/pr-watch` builds and caches the binary to `~/.cache/pi/pr-watch` on
first run and reuses it after that (rebuilds only if the source changed) --
same build-cache-stamp pattern as `.pi/agent/extensions/status-dock.sh`, but
this is its own tool, not part of the status dock. Requires Go.

A ref is one of:

- `https://github.com/owner/repo/pull/123`
- `owner/repo#123`
- `123` (bare number, resolved against the repo in the current directory)

### Interactive

```
pr-watch [ref ...]        watch these PRs, or the persisted list if none given
pr-watch --interval 15    refresh interval in seconds (default 30)
```

Keys: `↑/↓`/`j`/`k` move selection, `a` add, `d`/`x` remove selected, `r` retry
failed CI for the selected PR (`gh run rerun --failed` on its failing runs),
`f` retry + flag as a flake-check (once checks finish, labels the row
**flaky?** if it now passes on the same commit, or **confirmed** if it's
still failing), `o` open in browser, `q` quit. Repo/PR# and the PR link are
clickable (OSC 8) in terminals that support it. Header shows how long ago
the list last refreshed.

### Headless (scripting / agent use)

```
pr-watch --add <ref> [...]      add ref(s) to the persisted list, no watch
pr-watch --remove <ref> [...]   remove ref(s) from the persisted list, no watch
pr-watch --list                 print the persisted list and exit
pr-watch --once [<ref> ...]     render one snapshot and exit (no loop, no input)
pr-watch --json [<ref> ...]     raw JSON instead of a table (for scripting)
```

The persisted list lives at `~/.config/pr-watch/list` (one ref per line,
untracked, machine-local). When watching it (no refs given on the command
line), it's re-read on every refresh -- so another terminal, or an agent,
running `pr-watch --add <ref>` updates a running watch automatically.

### In pi

`/prs [ref ...]` opens a watcher in a new cmux pane split in the current
workspace (not a new tab) -- see `.pi/agent/extensions/pr-watch.ts`. `/prs
add|remove|list` manage the persisted list directly, no split needed.
