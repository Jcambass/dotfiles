---
description: Create or update a private resource note
argument-hint: "<resource> -- <note>"
---
Load and use the `note-taking` skill.

Create or update a note under a Resource in `${NOTES_ROOT:-$HOME/Notes}`.

Arguments:
$ARGUMENTS

Rules:
- Do not create an inbox note.
- If the resource does not exist, ask whether to create it with `note resource new`.
- Prefer `note add resource` for new notes.
- Meeting notes belong under `30 - Resources/Meetings`, not generic Resources.
- Preserve private note content; do not publish or push.
