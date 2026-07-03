# Notes

Dotfiles-managed helpers for a private Markdown notes repo.

Default notes root:

```bash
$HOME/Notes
```

Override with:

```bash
export NOTES_ROOT=/path/to/notes
```

## Structure

`note init` creates this layout:

```text
Notes/
├── 10 - Projects/
├── 20 - Areas/
├── 30 - Resources/
│   └── Meetings/
├── 40 - Archive/
└── .notes/templates/
```

There is intentionally no inbox. Put notes where they belong when creating them.

## Commands

```bash
note init
note root

note project new "Reflections 2026"
note project new --prefix 10.2 "Observability"
note project list

note area new "Mentoring"
note area list

note resource new "Reading List"
note resource list

note add project "Reflections 2026" --title "Feedback List"
note add area "Mentoring" --title "Coaching notes"
note add resource "Reading List" --title "Book notes"

note edit project "Reflections 2026"
note edit area "Mentoring" "coaching"
note edit resource "Reading List"

note meeting
note meeting "Fortnightly Sync"
note meeting --title "Design Review" --project "Reflections 2026"

# Without a title, note meeting uses the current calendar meeting when available.
# If multiple current meetings are found, choose one in the prompt.
# Re-running note meeting reuses the existing note instead of creating a duplicate.
# Calendar-derived notes include attendees in frontmatter and the Attendees section.

note archive project "Old Project"
note archive area "Old Area"
note archive resource "Old Topic"

note find "keyword"
note spell
note spell --fix "30 - Resources/Meetings"
note status
```

## Editor

The dotfiles keep `vim` aliased to `nvim`. Markdown files get spell checking via the shared Vim config.

## Install

The topic installer attempts to install:

- `neovim`
- `codespell`
- `aspell`

It uses Homebrew on macOS and `apt-get` on bp-dev/Codespaces when available.
