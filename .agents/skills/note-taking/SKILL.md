---
name: note-taking
description: "Create and edit private Markdown notes under numbered PARA folders: Projects, Areas, Resources, Archive, and meeting notes under Resources/Meetings. Use when the user asks to create projects or areas, add notes, create meeting notes, edit notes, archive notes, or correct spelling in notes."
---

# Note Taking

Use this skill for private Markdown notes in the user's Git-backed notes repository.

## Notes root

Resolve the notes root as:

```bash
${NOTES_ROOT:-$HOME/Notes}
```

Use the `note` CLI for file operations whenever possible.

## Required structure

Use the user's numbered PARA layout:

- `10 - Projects`
- `20 - Areas`
- `30 - Resources`
- `30 - Resources/Meetings`
- `40 - Archive`

Never create or use an inbox, `00-inbox`, or catch-all note destination.

## Rules

- If the user asks to add a note without a Project, Area, Resource, or Meeting target, ask where it should go or list existing targets.
- Use `note project new`, `note area new`, `note resource new`, `note add project`, `note add area`, `note add resource`, `note meeting`, and `note archive` instead of raw file writes when possible.
- For editing, use `note edit ...` or read/edit exact target files under `$NOTES_ROOT` only.
- Preserve YAML frontmatter when editing notes.
- Meeting notes must go under `30 - Resources/Meetings`.
- Do not invent meeting details, decisions, or action items.
- For calendar-derived meeting info, use WorkIQ only if it is configured and parseable; otherwise ask for a meeting title.
- For spelling, prefer minimal corrections and report changed files. Use `note spell` for obvious typos.
- Do not publish, upload, or push private notes without explicit approval.

## References

- `references/direct-notes.md` — structure and command examples.
- `references/meeting-notes.md` — meeting note rules and calendar fallback.
