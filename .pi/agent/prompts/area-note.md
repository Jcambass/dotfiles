---
description: Create or update a private area note
argument-hint: "<area> -- <note>"
---
Load and use the `note-taking` skill.

Create or update a note under an Area in `${NOTES_ROOT:-$HOME/Notes}`.

Arguments:
$ARGUMENTS

Rules:
- Do not create an inbox note.
- If the area does not exist, ask whether to create it with `note area new`.
- Prefer `note add area` for new notes.
- Preserve private note content; do not publish or push.
