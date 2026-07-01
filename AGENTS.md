# Dotfiles agent instructions

This repository is intended to be easy for AI agents to improve. Keep changes
small, explicit, and safe to apply on macOS, bp-dev, and Codespaces.

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

## Environment priorities

- macOS and bp-dev are first-class environments.
- Codespaces should stay supported, but it is used less often.
- Prefer behavior that works on both macOS and bp-dev. If something only works
  in one environment, gate it explicitly and document why.
- bp-dev should run Pi natively. macOS should keep the Docker-backed `docker-pi`
  path. Codespaces should run Pi natively.

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
