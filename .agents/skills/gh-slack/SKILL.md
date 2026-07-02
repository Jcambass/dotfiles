---
name: gh-slack
description: Fetch, archive, and summarize Slack conversations or threads from Slack permalinks using the rneatherway/gh-slack GitHub CLI extension. Use when asked to read Slack threads, capture Slack context, or post Slack archives to GitHub issues or PRs.
---

# gh-slack

Use `gh-slack` from `rneatherway/gh-slack` to fetch Slack conversations and threads as Markdown.

## Setup

Check whether Slack archive support is available before use:

```bash
gh-slack --help
```

If `gh-slack` is missing on macOS, run bootstrap so the dotfiles install the GitHub CLI extension and `~/.local/bin/gh-slack` shim. Do not fall back to ad-hoc token or cookie handling.

## Fetch a Slack thread or conversation

Start from a Slack message permalink supplied by the user.

```bash
gh-slack read <slack-permalink>
```

The default command is also `read`, so this is equivalent:

```bash
gh-slack <slack-permalink>
```

Useful flags:

```bash
gh-slack read --limit 20 <slack-permalink>       # channel messages after the start message; all thread replies are fetched
gh-slack read --details <slack-permalink>        # wrap output in GitHub-friendly <details> Markdown
gh-slack read --issue <issue-or-pr-url> <slack-permalink>  # post as comment, or create an issue when given a repository URL
gh-slack --verbose read <slack-permalink>        # debug errors only; avoid by default
```

Prefer capturing output to a temp file before summarizing or quoting:

```bash
gh-slack read --details <slack-permalink> > /tmp/slack-thread.md
```

## Workflow

1. Ask for a Slack permalink if the user did not provide one.
2. Run `gh-slack --help`.
3. If `gh-slack` is missing, ask the user to run bootstrap on macOS.
4. Fetch with `gh-slack read --details <permalink>` unless plain Markdown is requested.
5. Summarize by default. Quote only short excerpts that are necessary for the task.
6. Cite the Slack permalink and mention if output appears truncated.

## Authentication and secrets

`gh-slack` uses Slack cookie auth for the team in the permalink. If auth is missing or expired, report the error and ask the user to refresh Slack auth locally. Pi runs natively on macOS, so use the host `gh-slack` command directly instead of looking for container mounts or forwarded cookies.

The command below prints secrets that can impersonate the user:

```bash
gh-slack auth -t <team-name>
```

Do not run `gh-slack auth` unless explicitly needed, and never print, paste, log, summarize, or store its output. Prefer not to use `auth` at all. If a command emits tokens, cookies, or `SLACK_TOKEN` / `SLACK_COOKIES`, redact them immediately in any response.

## Safety

- Slack content may be private; only access links the user provided or clearly authorized.
- Do not post Slack archives to GitHub with `--issue` unless the user explicitly asks to publish them.
- Before posting to GitHub on the user's behalf, load and apply the `writing-voice` skill and ask for confirmation unless the user explicitly requested the post.
- Do not expose secrets, cookies, tokens, private keys, or large private conversation dumps.
- If the conversation is long, note that `gh-slack` does not page all results and output may be truncated.
