---
name: cmux
description: Control cmux workspaces, panes, surfaces, status/sidebar, browser panels, and notifications.
---

# cmux

Use the `cmux` CLI for all cmux operations. Commands communicate through the cmux Unix socket.

For command examples, read `references/command-reference.md`.

## Preflight

Check that the CLI is available before trying to control cmux:

```bash
command -v cmux
```

If `cmux` is unavailable, say so and stop. Do not fake cmux state.

To detect whether the current terminal is inside cmux, check `CMUX_WORKSPACE_ID`.

## Workflow

1. Use `cmux tree` to discover the current workspace, pane, and surface IDs.
2. Use refs like `workspace:1`, `pane:2`, and `surface:3`; do not use raw UUIDs.
3. Run the requested operation.
4. Use `cmux read-screen` or another read/list command to verify the result when it matters.
5. If a surface operation fails with `surface:invalid`, refresh IDs with `cmux tree` and retry only if the user request still makes sense.

## Common operations

- Workspaces and windows: list, create, rename, select.
- Panes and surfaces: split, focus, close, resize, swap, move.
- Input: send text or keypresses to a surface.
- Output: read the screen or scrollback.
- Sidebar: set status pills, progress, and log entries.
- Dock controls: right-sidebar terminal/browser controls from `dock.json`.
- Notifications: send desktop notifications.
- Browser panels: open, navigate, snapshot, click, type, evaluate JavaScript, or screenshot.

## Dock controls

Use Dock for right-sidebar terminal controls: feeds, logs, queues, git/status views, dev servers, test watchers, local services, or custom TUIs such as `cmux feed tui --opentui`.

Before editing Dock controls:

1. Run `cmux docs dock` when the CLI is available; otherwise read https://cmux.com/docs/dock.
2. Inspect the repository/current directory for project type, scripts, package manager, dev servers, logs, task runners, tests, README guidance, and existing TUI tools.
3. If the desired Dock is ambiguous, ask what should be monitored or controlled before writing files.

Where to write config:

- In a repository/project, create or edit `.cmux/dock.json` for shared teammate controls.
- For personal defaults outside a repo, create or edit `~/.config/cmux/dock.json`.
- If both exist, project `.cmux/dock.json` is more specific. Nested project configs apply to that directory tree.
- If there is no repo and no clear project root, use global config only after confirming the user wants a personal Dock.

Dock config schema:

```json
{
  "controls": [
    {
      "id": "short-stable-id",
      "title": "Human label",
      "command": "safe command to run",
      "cwd": "optional/path",
      "height": 220,
      "env": { "NAME": "value" }
    }
  ]
}
```

Dock rules:

- Keep ids stable, lowercase, and unique.
- Use `cwd` for subdirectories; relative paths resolve from the config base.
- Use `height` only when a control needs fixed vertical space.
- Use `env` only for non-secret values needed by one control.
- Do not put secrets, tokens, private hostnames, or machine-specific private paths in shared project config.
- Prefer commands that are safe to start repeatedly and make sense in a terminal.
- Do not invent unavailable scripts; read package files, Makefiles, Procfiles, READMEs, config files, and existing tooling first.
- Preserve existing useful controls unless asked to replace them.
- Validate JSON with `python3 -m json.tool <dock.json>` and summarize each control plus any commands the user should review before trusting project Dock config.

## Rules

1. **Always use `cmux tree`** to discover current surface and pane IDs; they change when panels close or reopen.
2. **Use refs** like `surface:3`, `pane:1`, and `workspace:1`; not raw UUIDs.
3. **Add short sleeps** between `cmux send` and `cmux send-key` calls, usually 0.1–0.3 seconds.
4. **Verify output** with `read-screen` or list commands instead of assuming success.
5. **Handle `surface:invalid` gracefully**; the surface may have been closed.
