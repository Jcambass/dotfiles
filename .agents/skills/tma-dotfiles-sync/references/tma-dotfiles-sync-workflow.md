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

## Inspect candidate files

Read upstream file content with `git show`:

```sh
git show refs/remotes/tma-dotfiles/main:AGENTS.md
git show refs/remotes/tma-dotfiles/main:.agents/skills/<skill>/SKILL.md
```

For directories:

```sh
git ls-tree -r --name-only refs/remotes/tma-dotfiles/main -- .agents common .pi
```

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
