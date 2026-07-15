# Dotfiles agent instructions

This repository is intended to be easy for AI agents to improve. Keep changes
small, explicit, and safe to apply on macOS, bp-dev, and Codespaces.

## Public repository boundaries

This repository is public.

Do not add secrets, credentials, tokens, private keys, customer data, internal
hostnames, internal service names, company-specific runbooks, private
documentation, or anything that depends on non-public systems.

Keep examples generic. Use placeholders like `owner/repo`, `example.com`,
`$HOME`, and `user@example.com` instead of real company, host, tenant, account,
or machine-specific values.

Before committing, scan changes for sensitive or company-specific content. If
something is useful but private, keep it outside the repository.

Existing public dotfiles names such as `bpdev` are part of this repository's
supported environments. Do not add new private names, hostnames, or runbooks
without explicit approval.

## Repository model

- System manifests live in `systems/`. They list repository-relative topic
  directories for each environment.
- Shared topics live under `common/`. Environment-specific topics live under
  `macos/`, `bpdev/`, or `codespaces/`.
- Do not bring back `common-*` symlinks in system directories. Add or remove
  topics by editing `systems/macos`, `systems/bpdev`, or `systems/codespaces`
  directly, or by using `script/common-link`.
- A topic can contain `install.sh`, `*.symlink`, `*.env`, shell files, and
  `bin/`. Keep related files together in the same topic.
- `.agents` and `.pi/agent` are normal managed configuration owned by
  `common/agents`; they just link into nested paths instead of directly into
  `$HOME`.
- Nested application configs live in `common/apps`. Keep macOS-only app configs
  gated there instead of linking them on bp-dev or Codespaces.

## Pi agent linking model

- `.pi/agent` is symlinked **per-file** from the repo into `~/.pi/agent`
  (`_agents_link_tree()` in `common/agents/install.sh`) — an **allowlist**:
  only paths that exist in the repo ever get symlinked. Do not switch this to
  symlinking `~/.pi/agent` as a single directory; that flips the model to a
  denylist and has already been evaluated and rejected. Real, untracked files
  already live directly in `~/.pi/agent` today (e.g. `mcp.json`,
  `workstream-registry.json`, `npm/`, `ayu/`) — safe only because the
  directory itself isn't a single symlinked unit, so the linker's per-item
  loop never even considers them (they don't exist in the repo source).
- **There is no path-exclusion list in `install.sh`**, and none is needed:
  paths like `auth.json`, `trust.json`, `sessions/`, `bin/`, `config/`, `gh/`
  simply never exist in the repo's tracked `.pi/agent` tree, so the linker's
  `for item in "$src_dir"/*` loop never encounters them. Keeping those paths
  out of the repo's own `git status` is root `.gitignore`'s job alone — plain
  git hygiene, already fully effective on its own. Do not add a parallel
  enforcement mechanism in `install.sh` for this; by the time such a file
  exists inside the tracked repo tree, `.gitignore` has already done (or
  failed to do) the only thing that actually matters — whether `git status`/
  `git add -A` would pick it up. A symlink-skip check in `install.sh` cannot
  retroactively fix that, so it isn't worth the extra code.
- **`script/pi-agent-doctor`'s drift audit does not use `.gitignore` either.**
  It only ever looks inside a top-level name under `~/.pi/agent` (or
  `~/.agents`) if that same name also exists in the repo (`extensions/`,
  `agents/`, `prompts/`, `settings.json`, ...). Anything else — `npm/`,
  `ayu/`, `mcp-oauth/`, `subagent-runs/`, `sessions/`, or whatever Pi invents
  next — is Pi/tool-owned local state with no repo-side counterpart, so it's
  out of scope automatically, with nothing to add to any list as Pi evolves.
  This was a deliberate choice over gitignore-driven scoping: a denylist of
  "known local Pi state" requires updating every time Pi ships something new
  (discovered live: `.agents/.skill-lock.json` and `~/.pi/agent/npm/` were
  both missed on the first pass); an allowlist derived from "does the repo
  have this" never goes stale.
- `~/.agents` has a *different* linking mode than `~/.pi/agent`:
  `_agents_link_global_agents()` symlinks the whole directory as one unit
  when possible (falling back to per-file linking only if `~/.agents`
  already exists as a real directory). `script/pi-agent-doctor` checks for
  this (`[ -L "$home_dir" ]`) and reports clean immediately in the
  whole-directory case — there's nothing to audit per-file when it's one
  symlink.
- **The atomic-write hazard**: never place a private/local companion file
  for a tracked extension at a path *inside* `~/.pi/agent` that might ever be
  symlinked, if the file is rewritten by any tool (ours or third-party) using
  a temp-file-then-rename pattern (`writeFileSync(tmp); rename(tmp, dest)`).
  `rename()` replaces whatever is at `dest`, including deleting a symlink and
  putting a real file in its place — silently, with no error. Confirmed
  present in `pi-mcp-adapter`'s `config.ts`/`metadata-cache.ts` (writes
  `mcp.json`/`mcp-cache.json`) and in this repo's own
  `.pi/agent/extensions/lib/workstreams.ts` `writeRegistryAtomic()` (writes
  `workstream-registry.json`). A gitignored "private/" redirect folder was
  tried for exactly this kind of file and reverted — see git log
  `8265de9`/`a84e7a6` if the full history is ever needed.
- **The one safe "split" pattern** for generic tracked code plus a
  private/local companion file: the companion file lives at a path
  **entirely outside** `~/.pi/agent` (e.g. `~/.config/pi/<name>.json`),
  located via an env var with a documented default, and the extension treats
  "file missing" as a silent no-op. This works because the file is never
  present in the repo at all, so the linker never touches its path. Canonical
  example: `.pi/agent/extensions/kusto-command.ts` (generic, tracked,
  symlinked) + `$PI_KUSTO_COMMANDS_CONFIG` / default
  `~/.config/pi/kusto-commands.json` (private, untracked, never symlinked,
  read-only). Use this pattern for the next "generic code + company-internal
  specifics" case instead of inventing a new one.
- Run `script/pi-agent-doctor` to check for drift on demand: real files that
  shadow a tracked repo path (should be a symlink but isn't), or real files
  that exist locally with no repo copy, inside the directories the repo
  actually tracks.

## Environment priorities

- macOS and bp-dev are first-class environments.
- Codespaces should stay supported, but it is used less often.
- Prefer behavior that works on both macOS and bp-dev. If something only works
  in one environment, gate it explicitly and document why.
- macOS, bp-dev, and Codespaces should run Pi natively.
- macOS should prefer cmux for the richest UI, with tmux kept as a fallback.

## Bootstrap rules

- `script/bootstrap` is non-interactive. It skips conflicting files by default,
  reports warnings, and prints a summary.
- Use `script/bootstrap --force` only when the user asked to overwrite local
  files.
- Use `script/bootstrap --backup` when preserving local files matters.
- Install scripts must be safe to run as subprocesses. Do not rely on sourced
  shell state leaking between topics.
- Do not commit machine-local state. Pi auth, sessions, generated binaries, and
  local configuration belong outside Git or in ignored paths.

## Change guidelines

- Prefer explicit manifests over implicit filesystem discovery.
- Keep `.pi`, `.agents`, and `common/agents` as editable dotfiles components,
  not vendor mirrors.
- Avoid broad rewrites. Make the smallest change that fully fixes the problem.
- Preserve existing user files by default. Warn instead of overwriting unless
  the user asked for force or backup behavior.
- Update `README.md` when commands, bootstrap behavior, or environment support
  changes.
- Keep shell scripts portable across the supported environments. Use Bash for
  install scripts and guard macOS-only commands.

## Checks

Run focused checks after changes:

```sh
bash -n script/bootstrap script/common-link common/agents/install.sh common/agents/pi.sh common/apps/install.sh
zsh -n common/zsh/zshenv.symlink common/zsh/zshrc.symlink common/zsh/config.zsh common/agents/pi.zsh
python3 -m json.tool common/agents/opencode.json >/dev/null
```

For bootstrap changes, smoke test with a temporary `HOME` and
`DOTFILES_SKIP_INSTALLS=1` for `macos`, `bpdev`, and `codespaces`.
