---
description: Fix spelling and lightly polish a private note without changing meaning
argument-hint: "<path>"
---
Load and use the `note-taking` skill.

Polish this note path or target:
$ARGUMENTS

Rules:
- Work only under `${NOTES_ROOT:-$HOME/Notes}`.
- Preserve YAML frontmatter.
- Fix spelling and light grammar only; do not change meaning.
- Do not invent facts, decisions, or action items.
- Show changed file paths and suggest inspecting `git diff`.
