---
name: gh-slack
description: Fetch, archive, and summarize Slack conversations or threads from Slack permalinks using the rneatherway/gh-slack GitHub CLI extension. Use when asked to read Slack threads, capture Slack context, or post Slack archives to GitHub issues or PRs.
---

# gh-slack

Use `gh slack` from `rneatherway/gh-slack` to fetch Slack conversations and threads as Markdown. Older `docker-pi` images may not support `gh slack` dispatch even when the `gh-slack` executable is present; in that case, call `gh-slack` directly.

## Setup

Check whether Slack archive support is available before use:

```bash
gh slack --help || gh-slack --help
```

If both commands are missing, install the GitHub CLI extension with:

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
# or, when gh extension dispatch is unavailable:
gh-slack read <slack-permalink>
```

The default command is also `read`, so these are equivalent:

```bash
gh slack <slack-permalink>
gh-slack <slack-permalink>
```

Useful flags:

```bash
gh slack read --limit 20 <slack-permalink>       # channel messages after the start message; all thread replies are fetched
gh slack read --details <slack-permalink>        # wrap output in GitHub-friendly <details> Markdown
gh slack read --issue <issue-or-pr-url> <slack-permalink>  # post as comment, or create an issue when given a repository URL
gh slack --verbose read <slack-permalink>        # debug errors only; avoid by default
# Replace `gh slack` with `gh-slack` when needed.
```

Prefer capturing output to a temp file before summarizing or quoting:

```bash
gh slack read --details <slack-permalink> > /tmp/slack-thread.md
# or:
gh-slack read --details <slack-permalink> > /tmp/slack-thread.md
```

## Workflow

1. Ask for a Slack permalink if the user did not provide one.
2. Run `gh slack --help`; if it fails, run `gh-slack --help`.
3. If both commands are missing, install the extension with `gh extension install https://github.com/rneatherway/gh-slack`.
4. Fetch with `gh slack read --details <permalink>` or `gh-slack read --details <permalink>` unless plain Markdown is requested.
5. Summarize by default. Quote only short excerpts that are necessary for the task.
6. Cite the Slack permalink and mention if output appears truncated.

## Authentication and secrets

`gh-slack` uses Slack cookie auth for the team in the permalink. If auth is missing or expired, report the error and ask the user to refresh Slack auth locally.

When running inside `docker-pi`, a missing `/root/.config/Slack/Cookies` error usually means the session was started before Slack mounts were available. For macOS-hosted Slack, cookie mounts alone may not be enough because the Linux container cannot decrypt keychain-backed cookies. A normal relaunch of `pi` should run host Slack auth automatically and forward temporary Slack auth into the container. If `gh slack` is unavailable but `gh-slack` works, use `gh-slack`; do not tell the user auth is broken. If both commands fail, ask the user to refresh Slack locally or check `docker-pi doctor`; do not ask for tokens or cookies.

The commands below print secrets that can impersonate the user:

```bash
gh slack auth -t <team-name>
gh-slack auth -t <team-name>
```

Do not run `gh slack auth` or `gh-slack auth` unless explicitly needed, and never print, paste, log, summarize, or store its output. Prefer not to use `auth` at all. If a command emits tokens, cookies, or `SLACK_TOKEN` / `SLACK_COOKIES`, redact them immediately in any response.

## Safety

- Slack content may be private; only access links the user provided or clearly authorized.
- Do not post Slack archives to GitHub with `--issue` unless the user explicitly asks to publish them.
- Before posting to GitHub on the user's behalf, load and apply the `writing-voice` skill and ask for confirmation unless the user explicitly requested the post.
- Do not expose secrets, cookies, tokens, private keys, or large private conversation dumps.
- If the conversation is long, note that `gh-slack` does not page all results and output may be truncated.
