# TMA dotfiles sync workflow

Use this workflow after loading the `tma-dotfiles-sync` skill.

## Fetch upstream

Use a local fetch ref instead of adding a permanent remote:

```sh
git fetch --no-tags https://github.com/tma/dotfiles.git \
  main:refs/remotes/tma-dotfiles/main
```

If `gh` authentication needs checking, use:

```sh
gh auth status
gh repo view tma/dotfiles --json defaultBranchRef --jq .defaultBranchRef.name
```

## Find the baseline

Prefer the shared-history baseline:

```sh
baseline=$(git merge-base HEAD refs/remotes/tma-dotfiles/main || true)
```

When `baseline` is non-empty, list upstream-only commits and files:

```sh
git --no-pager log --oneline --decorate "$baseline"..refs/remotes/tma-dotfiles/main
git --no-pager diff --name-status "$baseline"..refs/remotes/tma-dotfiles/main
```

Also show how those files differ from this repository now:

```sh
git --no-pager diff --stat HEAD..refs/remotes/tma-dotfiles/main -- <path>
git --no-pager diff HEAD..refs/remotes/tma-dotfiles/main -- <path>
```

If there is no useful shared history, say so and compare trees:

```sh
git --no-pager diff --name-status HEAD refs/remotes/tma-dotfiles/main
git --no-pager diff --stat HEAD refs/remotes/tma-dotfiles/main
```

When there is no shared history, do not describe recent upstream commits as
"since baseline." List a few recent commits only as context:

```sh
git --no-pager log --oneline -12 refs/remotes/tma-dotfiles/main
```

Current repository note: this local dotfiles repo may have no useful shared
history with `tma/dotfiles`, so expect a tree comparison.

## Last inspected upstream checkpoint

Last inspected upstream HEAD: `b56583f` (`Teach code reviews to read PR-linked
issues`). Next time, after fetching, first check whether upstream has moved:

```sh
git --no-pager log --oneline b56583f..refs/remotes/tma-dotfiles/main
```

If that range is empty, there are no newer upstream commits than the last
inspection. If it is non-empty, use those commits as the first-pass candidate
list, then fall back to the no-shared-history tree comparison only for files or
layout changes that need local/manual mapping.

At this checkpoint, the code-review PR-linked issue updates were selected for
manual porting. The Pi sandbox/docker-pi changes were inspected and the useful
pieces appeared already present locally: external `Dockerfile.pi`, nested Docker,
`~/.gitconfig` read-only mount plus container-local GitHub credential helpers,
realpath/symlink target mounts, `docker-pi doctor`, and host config path
resolution. Do not remove local-only additions such as `@microsoft/workiq`,
`set-clipboard`, Docker-backed macOS Pi notes, or bp-dev native Pi notes unless
the user asks.

## Inspect candidate files

Before inspecting candidates, check local worktree state and keep unrelated
local edits out of the sync:

```sh
git status --short --branch
```

Read upstream file content with `git show`:

```sh
git show refs/remotes/tma-dotfiles/main:AGENTS.md
git show refs/remotes/tma-dotfiles/main:.agents/skills/<skill>/SKILL.md
```

For directories:

```sh
git ls-tree -r --name-only refs/remotes/tma-dotfiles/main -- .agents .config .pi
```

Upstream currently uses a flatter layout with root dotfiles (`.bashrc`,
`.zshrc`, `.shellrc`, `.gitconfig`, `.tmux.conf`, `.gemrc`, `.config/...`, and
`install.sh`). This repo intentionally keeps topic directories and system
manifests (`common/`, `macos/`, `bpdev/`, `codespaces/`, `systems/`,
`script/bootstrap`). Treat tree-diff deletions or renames caused by that layout
mismatch as noise unless the user explicitly wants a layout migration.

Useful upstream-to-local path mappings to inspect manually:

- `.gitconfig` -> `common/git/gitconfig.symlink`
- `.gitignore` -> `.gitignore` and `common/git/gitignore.symlink`
- `.tmux.conf` -> `common/tmux/tmux.conf.symlink`
- `.shellrc` -> `common/agents/pi.sh` plus shell integration files
- `.zshrc` -> `common/zsh/zshrc.symlink` and `common/zsh/config.zsh`
- `.bashrc` -> `common/bash/bashrc.symlink`
- `.config/opencode/opencode.json` -> `common/agents/opencode.json`
- `.config/ghostty/config` -> `common/apps/config/ghostty/config`
- `.config/htop/htoprc` -> `common/apps/config/htop/htoprc`
- `.gemrc` -> `common/apps/gemrc`

Do not use `git restore --source=refs/remotes/tma-dotfiles/main -- <path>`
unless the user chose an exact replacement and the file has no local-only
behavior.

## Build options for the user

Group upstream changes into choices that can be integrated independently:

- agent instructions and skills
- Pi configuration
- tmux or terminal configuration
- shell or bootstrap behavior
- application configuration
- documentation-only changes

In no-shared-history tree comparisons, prefer low-noise options from overlapping
files and recent commit context. Call out broad upstream layout changes as a
separate high-conflict option rather than mixing them into smaller ports.

For each option, include:

- upstream commits or files involved
- local files that would change
- whether this is likely an exact copy, a manual port, or a conflict
- local behavior that must be preserved

Ask the user which option numbers to integrate. Freeform input is fine because
the user may choose multiple numbers.

## Integrate selected changes

Use manual patches for local superset files. Preserve:

- root `AGENTS.md` public-repository baseline plus local dotfiles rules
- macOS and bp-dev as first-class environments
- Codespaces support
- Docker-backed Pi on macOS
- native Pi on bp-dev and Codespaces
- `.agents` and `.pi/agent` as managed dotfiles components
- non-interactive bootstrap behavior
- local `jcambass/` branch-prefix rules and user-facing wording
- `writing-voice/references/user-curated-voice.md` as the local curated profile

Only cherry-pick upstream commits when the commit is narrow and does not remove
local behavior:

```sh
git cherry-pick -n <upstream-commit>
```

If cherry-pick conflicts, resolve only the selected topic. Do not fold unrelated
upstream changes into the same commit.

## Validate and commit

Run the focused checks from root `AGENTS.md`:

```sh
bash -n script/bootstrap script/common-link common/agents/install.sh common/agents/pi.sh common/apps/install.sh
zsh -n common/zsh/zshenv.symlink common/zsh/zshrc.symlink common/zsh/config.zsh common/agents/pi.zsh
python3 -m json.tool common/agents/opencode.json >/dev/null
```

For bootstrap changes, smoke test with temporary `HOME` and
`DOTFILES_SKIP_INSTALLS=1` for `macos`, `bpdev`, and `codespaces`.

Stage by topic and commit with a message that mentions the upstream source when
that helps future syncs.
