---
name: tma-dotfiles-sync
description: Check tma/dotfiles for new changes, summarize upstream commits and files, and guide selective integration into this dotfiles repository.
---

# TMA Dotfiles Sync

Use this skill when the user asks to check `tma/dotfiles`, compare against this
repository, list new upstream changes, or selectively integrate changes from
`https://github.com/tma/dotfiles`.

This repository is intentionally a superset of `tma/dotfiles`. Keep the baseline
close, but preserve local support for macOS, bp-dev, Codespaces, native Pi,
cmux/tmux status panels, and local skills or agent configuration.

For the full workflow and commands, read
`references/tma-dotfiles-sync-workflow.md`.

## Required workflow

1. Load the `github` and `git` skills first.
2. Fetch `tma/dotfiles` with `gh` and `git`; do not use browser scraping or raw
   HTTP tools.
3. Identify the upstream baseline:
   - Prefer a shared Git history with `merge-base`.
   - If there is no useful shared history, compare the current tree against the
     upstream `main` tree and say that this is a tree comparison, not a commit
     delta.
   - This repository may have no shared history with `tma/dotfiles`; in that
     case, treat recent upstream commits as context only, not a precise delta.
4. List upstream changes before editing:
   - commits since the baseline
   - changed files
   - likely integration options grouped by topic
   - clear conflicts with local custom behavior
5. Ask the user which option or options to integrate before changing files.
6. Port selected changes manually unless an exact file copy is clearly safe.
7. Preserve this repository's custom instructions and environment support.
8. Validate with the focused checks from root `AGENTS.md`.
9. Commit by topic, and mention which upstream commit or file each topic came
   from when useful.

## Integration rules

- Check `git status` before editing and do not touch unrelated local changes.
- Do not replace local files wholesale when they contain local-only behavior.
- Do not remove bp-dev or Codespaces support just because upstream lacks it.
- Do not reintroduce the old macOS Pi wrapper unless the user explicitly asks.
- Do not add private hostnames, credentials, machine names, or internal runbooks.
- Keep examples generic unless the value is already public in this repository.
- Do not port upstream owner-specific identity changes directly: keep local
  `jcambass/` branch naming, `user-curated-voice.md`, and "the user" wording
  unless the user explicitly asks to adopt `tma` naming.
- Prefer small, reversible commits.

## Output shape

When reporting available changes, use this shape:

```text
Found N upstream commits since <baseline>.

Options:
1. <topic> - <files>, <risk/conflict note>
2. <topic> - <files>, <risk/conflict note>
3. Skip for now
```

Then ask which numbers to integrate. Do not start applying changes until the
user chooses.
