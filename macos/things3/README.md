# Things 3 CLI

A plain, self-contained Python CLI for [Things 3](https://culturedcode.com/things/),
replicating the tool list from [hald/things-mcp](https://github.com/hald/things-mcp)
without any MCP server or protocol. Just run `things <subcommand> ...` from a
terminal or from bash.

Reads go through [`things.py`](https://pypi.org/project/things.py/), which
reads the local Things SQLite database directly. Writes go through the
Things URL scheme (AppleScript for areas, which the URL scheme doesn't
cover), executed the same foreground-safe way things-mcp does: via
`osascript -e 'do shell script "open -g \"<url>\""'`, so Things isn't pulled
to the front.

## Prerequisites

- Things 3 installed.
- Things → Settings → General → **Enable Things URLs** turned on. Without
  this, write commands (`add-todo`, `update-todo`, ...) will fail or be
  silently rejected.
- [`uv`](https://docs.astral.sh/uv/) installed. The script uses PEP 723
  inline metadata, so `uv` installs `things.py` into an ephemeral
  environment on first run — no separate `pip install` step.

## Usage

```sh
uv run macos/things3/bin/things <subcommand> [args]
# or, once executable:
macos/things3/bin/things <subcommand> [args]
```

Every read subcommand accepts `--json` to print raw JSON instead of one
line per item.

## Commands

| Command | Description |
|---|---|
| `inbox` | List todos in the Inbox |
| `today` | List today's todos |
| `upcoming` | List upcoming todos |
| `anytime` | List anytime todos |
| `someday` | List someday todos |
| `logbook` | List completed/canceled todos |
| `trash` | List trashed todos |
| `todos [--project UUID]` | List all todos, optionally filtered by project |
| `projects` | List projects |
| `areas` | List areas |
| `tags` | List tags |
| `tagged <tag>` | List items with a specific tag |
| `search <query>` | Search todos/projects/areas by title/notes |
| `recent <period>` | List items created recently, e.g. `3d`, `1w`, `2m`, `1y` |
| `add-todo --title ... [--notes] [--when] [--deadline] [--tags a,b] [--checklist "item1,item2"] [--list "Project Name"] [--heading ...]` | Create a new todo |
| `add-project --title ... [--notes] [--when] [--deadline] [--tags a,b] [--area "Area Name"] [--todos "todo1,todo2"]` | Create a new project |
| `update-todo <uuid> [--title] [--notes] [--when] [--deadline] [--tags a,b] [--add-tags a,b] [--completed] [--canceled] [--list ...] [--heading ...]` | Update an existing todo |
| `update-project <uuid> [--title] [--notes] [--when] [--deadline] [--tags a,b] [--area "Area Name"] [--completed] [--canceled]` | Update an existing project |
| `add-area --title ...` | Create a new area (via AppleScript; no URL-scheme command exists) |
| `update-area <uuid> [--title] [--tags a,b]` | Update an existing area (via AppleScript) |
| `show <uuid>` | Open a specific item in Things |

`--when` accepts keywords (`today`, `tomorrow`, `evening`, `anytime`,
`someday`), a date (`yyyy-mm-dd` or natural language like `in 3 days`), or a
datetime (`yyyy-mm-dd@HH:MM`) to add a reminder. `--deadline` accepts a date
in `yyyy-mm-dd` format.

## Notes

- There is deliberately no delete/remove command for anything, and no
  `update-area` tag-removal helper beyond replacing the full tag list —
  deleting an area in Things also deletes every project it contains, so
  that's intentionally out of scope.
- `update-todo`/`update-project` require the Things URL scheme auth token
  (read automatically via `things.py`). If "Enable Things URLs" isn't
  turned on, the CLI prints a warning and the update will likely be
  rejected by Things.
