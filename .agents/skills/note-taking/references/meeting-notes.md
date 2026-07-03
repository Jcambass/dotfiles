# Meeting notes

Meeting notes live under:

```text
30 - Resources/Meetings/
```

Use:

```bash
note meeting
note meeting "Fortnightly Sync"
note meeting --title "Design Review" --project "Reflections 2026"
note meeting --title "Mentoring sync" --area "Mentoring"
```

Meeting note sections should usually include:

- Attendees
- Notes
- Decisions
- Follow-ups

Do not invent attendees, decisions, or follow-ups. If content is unclear, mark it as unclear or ask.

## Calendar detection

`note meeting` without a title uses WorkIQ/current calendar detection when it is configured and reliable. If the current meeting cannot be identified confidently, ask the user for the title and use manual meeting creation. Re-running the command should reuse the existing meeting note instead of creating a duplicate.
