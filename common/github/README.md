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

Keys: `↑/↓`/`j`/`k` move selection (the detail pane below the table follows
the selection), `a` add, `d`/`x` remove selected, `r` retry failed CI for the
selected PR (`gh run rerun --failed` on its failing, actually-rerunnable
runs), `f` asks a fresh, tool-less `pi` session to look at the PR's diff and
the failing check's logs (or its name/context if it's an external status
check with no log, like a merge-stop bot) and judge whether the failure is
**pr-caused**, **unrelated** (flaky/pre-existing/infra), or **unclear** --
the same call you'd ask an agent to make manually, instead of empirically
re-running CI to guess. `o` opens the PR -- inside cmux, as a new browser
tab in the current workspace (`cmux browser open`); otherwise the system
default browser (`gh pr view --web`). `q` quit. `repo#123` is a single
clickable (OSC 8) link, styled underlined since terminals don't style
hyperlinks on their own. Header shows how long ago the list last refreshed.

The table's `CI` column is deliberately compact -- just whether *something*
needs attention: `ok` (green, everything's done and passed), `wait` (blue,
still running, nothing failed yet -- not the same as `ok`, it could still
fail), `req` (red, a **required** check is failing/waiting/external), or
`opt` (yellow, only non-required checks are). GitHub's required-check list
comes from `gh pr checks --required` (statusCheckRollup has no such flag
itself). A failing check is only actually rerunnable once its whole Actions
run has finished -- `gh run rerun` refuses mid-run ("cannot be rerun; This
workflow is already running") even if one job in it already failed; the
table doesn't distinguish that, the detail pane does.

Below the table, a detail pane for the *selected* PR shows what the table
can't: every failing check with its required/optional status and exactly
why it can't be rerun yet (still running vs. an external non-Actions check),
and the AI verdict/reason from `f`, persisted for the session instead of
flashing by in a 6-second status line. It's capped to fit the terminal
height, with the table always taking priority over the detail pane if space
is tight.

### Headless (scripting / agent use)

```
pr-watch --add <ref> [...]      add ref(s) to the persisted list, no watch
pr-watch --remove <ref> [...]   remove ref(s) from the persisted list, no watch
pr-watch --list                 print the persisted list and exit
pr-watch --once [<ref> ...]     render one snapshot and exit (no loop, no input)
pr-watch --json [<ref> ...]     raw JSON instead of a table (for scripting)
```

`--json` includes each check's name/workflow/required/action and the
persisted AI verdict/reason, not just the coarse overall CI state.

The persisted list lives at `~/.config/pr-watch/list` (one ref per line,
untracked, machine-local). When watching it (no refs given on the command
line), it's re-read on every refresh -- so another terminal, or an agent,
running `pr-watch --add <ref>` updates a running watch automatically.

### In pi

`/prs [ref ...]` opens a watcher in a new cmux pane split in the current
workspace (not a new tab) -- see `.pi/agent/extensions/pr-watch.ts`. `/prs
add|remove|list` manage the persisted list directly, no split needed.
