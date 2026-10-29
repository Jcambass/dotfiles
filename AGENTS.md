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
- `.agents` is managed configuration owned by `common/agents`; it links into a
  nested path instead of directly into `$HOME`.
- Nested application configs live in `common/apps`. Keep macOS-only app configs
  gated there instead of linking them on bp-dev or Codespaces.

## Shared agent linking model

`_agents_link_global_agents()` in `common/agents/install.sh` symlinks
`~/.agents` as a whole directory when possible. If it already exists as a real
directory, `_agents_link_tree()` links only files present in this repository,
preserving unrelated local files.

Keep local state and private companion files outside the tracked shared
configuration. Do not replace managed symlinks with files through atomic writes.
Run `script/agent-doctor` to audit real files shadowing managed links and local
additions inside shared directories. It only inspects top-level names that also
exist in the repository; unrelated tool-owned local state stays out of scope.

## External repo linking model

A paved path for referencing separate, mostly-private (or org-internal-
visibility) GitHub repos that hold company/personal-specific tooling this
repo can't hold itself, without ever committing that content here. First
real case: a repo containing a shared `gh` CLI extension.

- **Manifest**: `common/external-repos/repos.conf` (tracked, plain text --
  `name repo kind` per line, format documented inline in the file). Repo
  slugs and short names aren't secrets on their own (this repo already names
  an external repo, `rneatherway/gh-slack`, in `common/agents/install.sh`
  today) -- only a private repo's *contents* are sensitive, and those never
  live here.
- **Sync**: `script/external-repos-sync` clones/updates every entry into
  `${XDG_DATA_HOME:-$HOME/.local/share}/dotfiles/external/<name>` -- outside
  this repo's tree and outside `~/.agents`. External clones have no repo-side
  content and are not symlinked from here.
- **Always fails silently, never hangs, never wedges**: a machine without
  access to a given repo (no `gh auth`, no network, private/internal repo
  invisible to this account) gets a one-line "note", never a warning or a
  bootstrap failure. `GIT_TERMINAL_PROMPT=0` and batch-mode SSH are set
  explicitly so an inaccessible private repo fails fast instead of hanging
  bootstrap on a credential prompt that will never come. Every sync
  re-clones fresh into a temp dir and swaps it in, rather than
  fast-forwarding in place -- these are read-only mirrors, never edited
  locally, and a squash/rebase/force-push upstream (the common case for a
  repo that merges PRs) would otherwise permanently wedge a plain `git pull
  --ff-only`: it'd fail the exact same way, forever, on every future run.
- **Wired into bootstrap** via the `common/external-repos` topic's
  `install.sh`, which always exits 0 itself regardless of what the sync
  script encounters -- `script/bootstrap`'s install-script loop treats any
  non-zero exit as fatal for the *whole run*, not just that topic, so this
  wrapper's own exit code is load-bearing. Skip entirely with
  `DOTFILES_SKIP_EXTERNAL_REPOS_SYNC=1` (or the existing global
  `DOTFILES_SKIP_INSTALLS=1`).
- **Listed on `macos` and `bpdev` only, deliberately not `codespaces`**:
  Codespaces' default token is scoped to the creating repo and generally
  can't reach arbitrary private/org-internal slugs, so every entry would
  fail on every codespace, every rebuild -- pure recurring noise for zero
  benefit, not the "silent and free" case the mechanism is designed for
  elsewhere.
- **Different from, and does not resurrect,** the `private/`-inside-the-repo
  pattern tried in commit `8265de9` and reverted in `a84e7a6`: that was a
  gitignored subtree of *this* repo that never synced anywhere on its own.
  These are independent external git remotes, each syncing via their own
  clone, stored entirely outside this repo's tree -- not even gitignored,
  because nothing ever lands inside the repo to ignore.
- **Adding a new repo** (the actual paved path): create/confirm the repo
  exists on GitHub (private or internal visibility, your call per repo), add
  one line to `repos.conf` (`name  owner/repo  gh-extension`), run
  `script/external-repos-sync` or a full bootstrap. For `gh-extension`,
  nothing else needs wiring up -- `gh <name>` works on any machine that can
  clone it. Removing a line does not prune the on-disk clone; if that ever
  matters, delete it manually from under `dotfiles/external/` in
  `$XDG_DATA_HOME`/`~/.local/share`.

## Environment priorities

- macOS and bp-dev are first-class environments.
- Codespaces should stay supported, but it is used less often.
- Prefer behavior that works on both macOS and bp-dev. If something only works
  in one environment, gate it explicitly and document why.
- macOS should prefer cmux for the richest UI, with tmux kept as a fallback.

## Bootstrap rules

- `script/bootstrap` is non-interactive. It skips conflicting files by default,
  reports warnings, and prints a summary.
- Use `script/bootstrap --force` only when the user asked to overwrite local
  files.
- Use `script/bootstrap --backup` when preserving local files matters.
- Install scripts must be safe to run as subprocesses. Do not rely on sourced
  shell state leaking between topics.
- Do not commit machine-local state. Agent auth, sessions, generated binaries, and
  local configuration belong outside Git or in ignored paths.

## Change guidelines

- Prefer explicit manifests over implicit filesystem discovery.
- Keep `.agents` and `common/agents` as editable dotfiles components,
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
bash -n script/bootstrap script/common-link script/agent-doctor common/agents/install.sh common/apps/install.sh
zsh -n common/zsh/zshenv.symlink common/zsh/zshrc.symlink common/zsh/config.zsh
python3 -m json.tool common/agents/opencode.json >/dev/null
```

For bootstrap changes, smoke test with a temporary `HOME` and
`DOTFILES_SKIP_INSTALLS=1` for `macos`, `bpdev`, and `codespaces`.
