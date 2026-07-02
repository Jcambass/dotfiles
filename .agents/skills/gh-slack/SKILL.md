---
name: gh-slack
description: Fetch, archive, and summarize Slack conversations or threads from Slack permalinks using the rneatherway/gh-slack GitHub CLI extension. Use when asked to read Slack threads, capture Slack context, or post Slack archives to GitHub issues or PRs.
---

# gh-slack

Use the `gh slack` GitHub CLI extension from `rneatherway/gh-slack` to fetch Slack conversations and threads as Markdown.

## Setup

Check whether the extension is available before use:

```bash
gh slack --help
```

If `gh slack` is missing, install it with:

```bash
gh extension install https://github.com/rneatherway/gh-slack
```

Upgrade when needed:

```bash
gh extension upgrade gh-slack
```

## Fetch a Slack thread or conversation

Start from a Slack message permalink supplied by the user.

```bash
gh slack read <slack-permalink>
```

The default command is also `read`, so this is equivalent:

```bash
gh slack <slack-permalink>
```

Useful flags:

```bash
gh slack read --limit 20 <slack-permalink>       # channel messages after the start message; all thread replies are fetched
gh slack read --details <slack-permalink>        # wrap output in GitHub-friendly <details> Markdown
gh slack read --issue <issue-or-pr-url> <slack-permalink>  # post as comment, or create an issue when given a repo URL
gh slack --verbose read <slack-permalink>        # debug errors only; avoid by default
```

Prefer capturing output to a temp file before summarizing or quoting:

```bash
gh slack read --details <slack-permalink> > /tmp/slack-thread.md
```

## Workflow

1. Ask for a Slack permalink if the user did not provide one.
2. Run `gh slack --help`; install the extension if it is missing.
3. Fetch with `gh slack read --details <permalink>` unless plain Markdown is requested.
4. Summarize by default. Quote only short excerpts that are necessary for the task.
5. Cite the Slack permalink and mention if output appears truncated.

## Authentication and secrets

`gh-slack` uses Slack cookie auth for the team in the permalink. If auth is missing or expired, report the error and ask the user to refresh Slack auth locally.

When running inside `docker-pi`, a missing `/root/.config/Slack/Cookies` error usually means the session was started before Slack mounts were available. For macOS-hosted Slack, cookie mounts alone may not be enough because the Linux container cannot decrypt keychain-backed cookies. A normal relaunch of `pi` should run host `gh slack auth -t github` automatically and forward temporary Slack auth into the container. If it still fails, ask the user to refresh Slack locally or check `docker-pi doctor`; do not ask for tokens or cookies.

The command below prints secrets that can impersonate the user:

```bash
gh slack auth -t <team-name>
```

Do not run `gh slack auth` unless explicitly needed, and never print, paste, log, summarize, or store its output. Prefer not to use `auth` at all. If a command emits tokens, cookies, or `SLACK_TOKEN` / `SLACK_COOKIES`, redact them immediately in any response.

## Safety

- Slack content may be private; only access links the user provided or clearly authorized.
- Do not post Slack archives to GitHub with `--issue` unless the user explicitly asks to publish them.
- Before posting to GitHub on the user's behalf, load and apply the `writing-voice` skill and ask for confirmation unless the user explicitly requested the post.
- Do not expose secrets, cookies, tokens, private keys, or large private conversation dumps.
- If the conversation is long, note that `gh-slack` does not page all results and output may be truncated.
