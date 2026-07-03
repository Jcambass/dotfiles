---
description: Create or update a private project note
argument-hint: "<project> -- <note>"
---
Load and use the `note-taking` skill.

Create or update a note under a Project in `${NOTES_ROOT:-$HOME/Notes}`.

Arguments:
$ARGUMENTS

Rules:
- Do not create an inbox note.
- If the project does not exist, ask whether to create it with `note project new`.
- Prefer `note add project` for new notes.
- Preserve private note content; do not publish or push.
