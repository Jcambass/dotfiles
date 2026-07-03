# Direct notes workflow

Notes live in a private Markdown repository at `${NOTES_ROOT:-$HOME/Notes}`.

## Structure

```text
10 - Projects/
20 - Areas/
30 - Resources/
30 - Resources/Meetings/
40 - Archive/
```

There is no inbox. Notes must be created in a Project, Area, Resource, or as a Meeting note.

## Project vs Area vs Resource

- **Project**: active outcome with a finish line.
- **Area**: ongoing responsibility or standard to maintain.
- **Resource**: reference material or reusable knowledge.
- **Archive**: inactive projects, areas, and resources moved there explicitly.

## Commands

```bash
note project new "Reflections 2026"
note project new --prefix 10.2 "Observability"
note area new "Mentoring"
note resource new "Reading List"

note add project "Reflections 2026" --title "Feedback List" "..."
note add area "Mentoring" --title "Coaching notes" "..."
note add resource "Reading List" --title "Book notes" "..."

note edit project "Reflections 2026"
note edit area "Mentoring" "coaching"
note edit resource "Reading List"

note archive project "Old Project"
note find "keyword"
note spell
```
