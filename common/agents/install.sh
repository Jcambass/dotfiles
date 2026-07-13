#!/usr/bin/env bash

_agents_warnings=()

_agents_log() {
  printf '  [ agents ] %s\n' "$*"
}

_agents_supports_color() {
  [ -t 2 ] && [ -z "${NO_COLOR:-}" ]
}

_agents_warn() {
  local message="$*"
  _agents_warnings+=("$message")

  if _agents_supports_color; then
    printf '  [ \033[00;33magents\033[0m ] \033[00;33mwarning:\033[0m %s\n' "$message" >&2
  else
    printf '  [ agents ] warning: %s\n' "$message" >&2
  fi
}

_agents_print_warning_summary() {
  local warning count
  count="${#_agents_warnings[@]}"

  if [ "$count" -eq 0 ]; then
    return 0
  fi

  if _agents_supports_color; then
    printf '  [ \033[00;33magents\033[0m ] \033[00;33m%d warning(s)\033[0m during agent setup:\n' "$count" >&2
  else
    printf '  [ agents ] %d warning(s) during agent setup:\n' "$count" >&2
  fi

  for warning in "${_agents_warnings[@]}"; do
    printf '    - %s\n' "$warning" >&2
  done
}

_agents_root() {
  if [ -n "${DOTFILES_ROOT:-}" ]; then
    printf '%s\n' "$DOTFILES_ROOT"
    return
  fi

  if [ -n "${BASH_SOURCE[0]:-}" ]; then
    (cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd -P)
    return
  fi

  pwd -P
}

_agents_system_type() {
  if [ -n "${DOTFILE_SYSTEM_TYPE:-}" ]; then
    printf '%s\n' "$DOTFILE_SYSTEM_TYPE"
    return
  fi

  local root
  root="$(_agents_root)"
  if [ -f "$root/.system" ]; then
    head -n 1 "$root/.system" 2>/dev/null
    return
  fi

  printf '%s\n' unknown
}

_agents_is_codespaces() {
  [ "$(_agents_system_type)" = "codespaces" ]
}

_agents_is_bpdev() {
  [ "$(_agents_system_type)" = "bpdev" ]
}

_agents_is_macos() {
  [ "$(_agents_system_type)" = "macos" ]
}

_agents_is_agent_host() {
  _agents_is_macos || _agents_is_codespaces || _agents_is_bpdev
}

_agents_can_apt() {
  command -v sudo >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1
}

_agents_apt_install() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi

  if ! _agents_can_apt; then
    _agents_warn "sudo or apt-get unavailable; cannot install: $*"
    return 1
  fi

  _agents_log "installing packages: $*"
  sudo apt-get update \
    && sudo apt-get install -y --no-install-recommends "$@"
}

_agents_can_brew() {
  command -v brew >/dev/null 2>&1
}

_agents_ensure_homebrew() {
  if _agents_can_brew; then
    _agents_trust_homebrew_taps
    return 0
  fi

  if ! _agents_is_macos; then
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    _agents_warn "curl unavailable; cannot install Homebrew"
    return 1
  fi

  _agents_log "installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || return 1

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  _agents_can_brew && _agents_trust_homebrew_taps
}

_agents_trust_homebrew_taps() {
  local tap

  if [ -n "${DOTFILES_SKIP_HOMEBREW_TRUST:-}" ]; then
    return 0
  fi

  if ! _agents_can_brew || ! brew trust --help >/dev/null 2>&1; then
    return 0
  fi

  for tap in github/bootstrap jcambass/tailhopper jcambass/tap manaflow-ai/cmux; do
    if brew tap | grep -qx "$tap"; then
      brew trust "$tap" >/dev/null 2>&1 || _agents_warn "could not trust Homebrew tap $tap; continuing"
    fi
  done
}

_agents_brew_install() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi

  _agents_ensure_homebrew || {
    _agents_warn "Homebrew unavailable; cannot install: $*"
    return 1
  }

  _agents_log "installing packages: $*"
  brew install "$@"
}

_agents_has_modern_bash() {
  local bash_bin

  for bash_bin in /opt/homebrew/bin/bash /usr/local/bin/bash bash; do
    command -v "$bash_bin" >/dev/null 2>&1 || continue
    "$bash_bin" -c '[ "${BASH_VERSINFO[0]}" -ge 4 ]' >/dev/null 2>&1 && return 0
  done

  return 1
}

_agents_ensure_agent_tools() {
  local packages=()

  if [ -n "${DOTFILES_SKIP_AGENT_INSTALL:-}" ]; then
    return 0
  fi

  if ! _agents_is_agent_host; then
    return 0
  fi

  if _agents_is_macos; then
    command -v curl >/dev/null 2>&1 || packages+=(curl)
    command -v git >/dev/null 2>&1 || packages+=(git)
    command -v gh >/dev/null 2>&1 || packages+=(gh)
    command -v jq >/dev/null 2>&1 || packages+=(jq)
    command -v rg >/dev/null 2>&1 || packages+=(ripgrep)
    command -v tmux >/dev/null 2>&1 || packages+=(tmux)
    _agents_has_modern_bash || packages+=(bash)
    command -v node >/dev/null 2>&1 || packages+=(node)
    command -v pup >/dev/null 2>&1 || packages+=(pup)
    command -v opencode >/dev/null 2>&1 || packages+=(opencode)

    _agents_brew_install "${packages[@]}" || return 0

    if ! command -v cmux >/dev/null 2>&1 && _agents_ensure_homebrew; then
      _agents_log "installing cmux"
      brew tap manaflow-ai/cmux
      _agents_trust_homebrew_taps
      brew install --cask cmux || _agents_warn "cmux install failed; continuing"
    fi

    return 0
  fi

  [ -f /etc/ssl/certs/ca-certificates.crt ] || packages+=(ca-certificates)
  command -v curl >/dev/null 2>&1 || packages+=(curl)
  command -v git >/dev/null 2>&1 || packages+=(git)
  command -v jq >/dev/null 2>&1 || packages+=(jq)
  command -v rg >/dev/null 2>&1 || packages+=(ripgrep)
  command -v tmux >/dev/null 2>&1 || packages+=(tmux)

  _agents_apt_install "${packages[@]}" || return 0
  _agents_ensure_gh || return 0
  _agents_ensure_pup || return 0
}

_agents_ensure_gh() {
  if command -v gh >/dev/null 2>&1; then
    return 0
  fi

  if ! _agents_can_apt; then
    _agents_warn "gh unavailable and sudo/apt-get are missing; skipping GitHub CLI install"
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    _agents_apt_install curl ca-certificates || return 0
  fi

  _agents_log "installing GitHub CLI"
  sudo mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
    && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
    && sudo apt-get update \
    && sudo apt-get install -y --no-install-recommends gh \
    || _agents_warn "GitHub CLI install failed; continuing"
}

_agents_sha256_file() {
  local file="$1"

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
    return
  fi

  return 1
}

_agents_gh_data_dir() {
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s\n' "$XDG_DATA_HOME/gh"
    return
  fi

  printf '%s\n' "$HOME/.local/share/gh"
}

_agents_gh_slack_source_dir() {
  printf '%s\n' "$(_agents_gh_data_dir)/extension-src/gh-slack"
}

_agents_can_install_gh_slack_release() {
  case "$(uname -s)/$(uname -m)" in
    Darwin/*|Linux/x86_64|Linux/amd64) return 0 ;;
    *) return 1 ;;
  esac
}

_agents_install_gh_slack_shim() {
  local bin_dir="$HOME/.local/bin"
  local shim="$bin_dir/gh-slack"

  if command -v gh-slack >/dev/null 2>&1; then
    return 0
  fi

  mkdir -p "$bin_dir" || {
    _agents_warn "could not create $bin_dir; skipping gh-slack shim"
    return 0
  }

  cat > "$shim" <<'EOF'
#!/usr/bin/env bash
exec gh slack "$@"
EOF
  chmod +x "$shim" || _agents_warn "could not make $shim executable"
}

_agents_install_gh_slack_from_source() {
  local src_dir src_parent tag commit version ldflags

  if ! command -v git >/dev/null 2>&1; then
    _agents_warn "git unavailable; skipping gh-slack source build"
    return 0
  fi

  if ! command -v go >/dev/null 2>&1; then
    _agents_warn "go unavailable; skipping gh-slack source build"
    return 0
  fi

  src_dir="$(_agents_gh_slack_source_dir)"
  src_parent="$(dirname "$src_dir")"
  mkdir -p "$src_parent" || {
    _agents_warn "could not create $src_parent; skipping gh-slack source build"
    return 0
  }

  tag="$(gh release view --repo rneatherway/gh-slack --json tagName --jq .tagName 2>/dev/null || true)"
  if [ -z "$tag" ]; then
    tag="main"
  fi

  if [ -d "$src_dir/.git" ]; then
    _agents_log "updating gh-slack source"
    git -C "$src_dir" fetch --tags --force --prune origin || {
      _agents_warn "gh-slack source update failed; continuing with existing checkout"
    }
  elif [ -e "$src_dir" ]; then
    _agents_warn "$src_dir exists but is not a git checkout; skipping gh-slack source build"
    return 0
  else
    _agents_log "cloning gh-slack source"
    gh repo clone rneatherway/gh-slack "$src_dir" -- --depth 1 || {
      _agents_warn "gh-slack source clone failed; continuing"
      return 0
    }
  fi

  if [ "$tag" = "main" ]; then
    git -C "$src_dir" checkout main >/dev/null 2>&1 \
      || _agents_warn "could not check out gh-slack main; continuing with current checkout"
    git -C "$src_dir" pull --ff-only >/dev/null 2>&1 \
      || _agents_warn "could not fast-forward gh-slack source; continuing with current checkout"
  else
    git -C "$src_dir" checkout --detach "$tag" >/dev/null 2>&1 \
      || _agents_warn "could not check out gh-slack $tag; continuing with current checkout"
  fi

  commit="$(git -C "$src_dir" rev-parse --short HEAD 2>/dev/null || true)"
  version="$tag"
  ldflags="-X github.com/rneatherway/gh-slack/internal/version.version=$version -X github.com/rneatherway/gh-slack/internal/version.commit=$commit"

  _agents_log "building gh-slack from source"
  (cd "$src_dir" && go build -ldflags "$ldflags" -o gh-slack ./cmd/gh-slack) || {
    _agents_warn "gh-slack source build failed; continuing"
    return 0
  }
  chmod +x "$src_dir/gh-slack" || true
  mkdir -p "$HOME/.local/bin" || true
  cp "$src_dir/gh-slack" "$HOME/.local/bin/gh-slack" 2>/dev/null \
    && chmod +x "$HOME/.local/bin/gh-slack" \
    || _agents_warn "could not install gh-slack binary to $HOME/.local/bin; continuing"

  _agents_log "installing gh-slack extension from local source"
  (cd "$src_dir" && gh extension install . --force) \
    || _agents_warn "gh-slack local extension install failed; continuing"
}

_agents_ensure_gh_slack() {
  if [ -n "${DOTFILES_SKIP_AGENT_INSTALL:-}" ]; then
    return 0
  fi

  if ! _agents_is_agent_host; then
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    _agents_warn "gh unavailable; skipping gh-slack extension install"
    return 0
  fi

  if command -v gh-slack >/dev/null 2>&1; then
    return 0
  fi

  if gh slack --help >/dev/null 2>&1; then
    _agents_install_gh_slack_shim
    return 0
  fi

  if _agents_can_install_gh_slack_release; then
    _agents_log "installing gh-slack extension"
    if gh extension install https://github.com/rneatherway/gh-slack; then
      _agents_install_gh_slack_shim
      return 0
    fi
    _agents_warn "gh-slack extension install failed; falling back to source build"
  else
    _agents_log "building gh-slack extension from source for $(uname -s)/$(uname -m)"
  fi

  _agents_install_gh_slack_from_source
}

_agents_pup_release_version() {
  if command -v gh >/dev/null 2>&1; then
    gh release view --repo DataDog/pup --json tagName --jq .tagName 2>/dev/null | sed 's/^v//'
    return
  fi

  printf '%s\n' "1.6.0"
}

_agents_ensure_pup() {
  local version os arch asset url tmpdir

  if command -v pup >/dev/null 2>&1; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    _agents_log "installing pup"
    brew install pup || _agents_warn "pup install failed; continuing"
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    _agents_warn "curl or tar unavailable; skipping pup install"
    return 0
  fi

  case "$(uname -s)" in
    Linux) os="Linux" ;;
    Darwin) os="Darwin" ;;
    *) _agents_warn "unsupported OS for pup install; continuing"; return 0 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x86_64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) _agents_warn "unsupported architecture for pup install; continuing"; return 0 ;;
  esac

  version="$(_agents_pup_release_version)"
  if [ -z "$version" ]; then
    version="1.6.0"
  fi

  asset="pup_${version}_${os}_${arch}.tar.gz"
  url="https://github.com/DataDog/pup/releases/download/v${version}/${asset}"
  tmpdir="$(mktemp -d)"
  mkdir -p "$HOME/.local/bin"

  _agents_log "installing pup ${version}"
  if curl -fsSL "$url" | tar -xz -C "$tmpdir" pup \
    && mv "$tmpdir/pup" "$HOME/.local/bin/pup" \
    && chmod +x "$HOME/.local/bin/pup"; then
    rm -rf "$tmpdir"
    return 0
  fi

  rm -rf "$tmpdir"
  _agents_warn "pup install failed; continuing"
  return 0
}

_agents_realpath() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null
    return
  fi

  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null
    return
  fi

  printf '%s\n' "$1"
}

_agents_same_path() {
  [ "$(_agents_realpath "$1" 2>/dev/null)" = "$(_agents_realpath "$2" 2>/dev/null)" ]
}

_agents_safe_link() {
  local src="$1" dest="$2"

  if [ -d "$src" ] && [ -d "$dest" ] && [ ! -L "$dest" ]; then
    _agents_link_tree "$src" "$dest"
    return
  fi

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ -L "$dest" ]; then
      rm "$dest" || return 1
    else
      _agents_warn "skipping $dest; exists and is not a symlink"
      return 0
    fi
  fi

  mkdir -p "$(dirname "$dest")" || return 1
  ln -s "$src" "$dest" && _agents_log "linked $dest -> $src"
}

_agents_remove_managed_link() {
  local src="$1" dest="$2"

  if [ ! -L "$dest" ]; then
    return 0
  fi

  if _agents_same_path "$dest" "$src"; then
    rm "$dest" && _agents_log "disabled $dest on bp-dev"
  fi
}

_agents_should_skip_pi_item() {
  local rel="$1"

  case "$rel" in
    auth.json|trust.json|sessions|sessions/*|bin|bin/*|config|config/*|gh|gh/*)
      return 0
      ;;
  esac

  return 1
}

_agents_link_tree() {
  local src_dir="$1" dest_dir="$2" root="$3"
  local item name rel

  if [ -L "$dest_dir" ]; then
    rm "$dest_dir" || return 1
  fi
  mkdir -p "$dest_dir" || return 1
  for item in "$src_dir"/*; do
    [ -e "$item" ] || continue
    name="$(basename "$item")"
    if [ -n "${root:-}" ]; then
      rel="${item#$root/}"
      if _agents_should_skip_pi_item "$rel"; then
        _agents_remove_managed_link "$item" "$dest_dir/$name"
        continue
      fi
    fi

    if [ -d "$item" ]; then
      _agents_link_tree "$item" "$dest_dir/$name" "${root:-}"
    else
      _agents_safe_link "$item" "$dest_dir/$name"
    fi
  done
}

_agents_link_global_agents() {
  local root="$1" src="$root/.agents" dest="$HOME/.agents"

  [ -d "$src" ] || return 0

  if [ -e "$dest" ] && [ ! -L "$dest" ] && [ -d "$dest" ]; then
    _agents_link_tree "$src" "$dest"
  else
    _agents_safe_link "$src" "$dest"
  fi
}

_agents_link_pi_agent() {
  local root="$1" src="$root/.pi/agent" dest="$HOME/.pi/agent"
  local old_skills_target agents_md state_path

  [ -d "$src" ] || return 0
  mkdir -p "$dest" || return 1

  for state_path in auth.json trust.json sessions bin config gh; do
    if [ -L "$dest/$state_path" ]; then
      rm "$dest/$state_path" && _agents_log "removed managed state link $dest/$state_path"
    fi
  done

  if [ -L "$dest/skills" ]; then
    old_skills_target="$(readlink "$dest/skills" 2>/dev/null || true)"
    case "$old_skills_target" in
      "$root/.pi/agent/skills"|"$root/.agents/skills")
        rm "$dest/skills" && _agents_log "removed stale $dest/skills"
        ;;
    esac
  fi

  _agents_link_tree "$src" "$dest" "$src"

  agents_md="$root/.agents/AGENTS.md"
  if [ -f "$agents_md" ]; then
    _agents_safe_link "$agents_md" "$dest/AGENTS.md"
  fi
}

_agents_remove_stale_extension_link() {
  local root="$1" filename="$2"
  local expected_src dest

  expected_src="$root/.pi/agent/extensions/$filename"
  dest="$HOME/.pi/agent/extensions/$filename"

  # Source still present in repo — nothing to prune
  if [ -e "$expected_src" ]; then
    return 0
  fi

  # Not a symlink — leave it alone (user-owned or generated file)
  if [ ! -L "$dest" ]; then
    return 0
  fi

  # Only remove if the symlink resolves back to the expected repo location
  if ! _agents_same_path "$dest" "$expected_src"; then
    return 0
  fi

  rm "$dest" && _agents_log "removed stale extension link $dest"
}

_agents_link_opencode_config() {
  local root="$1" src="$root/common/agents/opencode.json" dest="$HOME/.config/opencode/opencode.json"

  [ -f "$src" ] || return 0
  _agents_safe_link "$src" "$dest"
}

_agents_ensure_node() {
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi

  if ! _agents_is_agent_host; then
    return 1
  fi

  if _agents_is_macos; then
    _agents_brew_install node
    return
  fi

  if ! command -v curl >/dev/null 2>&1 || ! _agents_can_apt; then
    _agents_warn "npm is unavailable and curl/sudo/apt-get are not all present; skipping Pi install"
    return 1
  fi

  _agents_log "installing Node.js LTS"
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - \
    && sudo apt-get install -y nodejs
}

_agents_install_or_update_pi() {
  local npm_prefix="${NPM_CONFIG_PREFIX:-$HOME/.local}"

  if [ -n "${DOTFILES_SKIP_AGENT_INSTALL:-}" ]; then
    _agents_log "skipping Pi install because DOTFILES_SKIP_AGENT_INSTALL is set"
    return 0
  fi

  if ! _agents_is_agent_host; then
    if command -v pi >/dev/null 2>&1; then
      _agents_log "pi already available outside managed agent hosts; leaving it untouched"
    else
      _agents_log "skipping Pi install outside managed agent hosts"
    fi
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1 && ! _agents_ensure_node; then
    return 0
  fi

  mkdir -p "$npm_prefix/bin" "$npm_prefix/lib" || {
    _agents_warn "failed to prepare npm prefix $npm_prefix; skipping Pi install"
    return 0
  }

  if command -v pi >/dev/null 2>&1; then
    _agents_log "updating Pi"
  else
    _agents_log "installing Pi"
  fi

  NPM_CONFIG_PREFIX="$npm_prefix" npm install -g @earendil-works/pi-coding-agent \
    || _agents_warn "Pi install failed; continuing"
}

_agents_setup_cmux_pi_hooks() {
  if ! _agents_is_macos; then
    return 0
  fi

  if [ -n "${DOTFILES_SKIP_CMUX_HOOKS:-}" ]; then
    _agents_log "skipping cmux Pi hook setup because DOTFILES_SKIP_CMUX_HOOKS is set"
    return 0
  fi

  if ! command -v cmux >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v pi >/dev/null 2>&1; then
    return 0
  fi

  _agents_log "setting up cmux Pi hooks"
  if cmux hooks setup --agent pi --yes >/dev/null 2>&1; then
    return 0
  fi

  if cmux hooks pi install --yes >/dev/null 2>&1; then
    return 0
  fi

  _agents_warn "cmux Pi hook setup failed; continuing"
  return 0
}

_agents_install_or_update_workiq() {
  local npm_prefix="${NPM_CONFIG_PREFIX:-$HOME/.local}"

  if [ -n "${DOTFILES_SKIP_AGENT_INSTALL:-}" ]; then
    return 0
  fi

  if ! _agents_is_agent_host; then
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1 && ! _agents_ensure_node; then
    return 0
  fi

  mkdir -p "$npm_prefix/bin" "$npm_prefix/lib" || {
    _agents_warn "failed to prepare npm prefix $npm_prefix; skipping WorkIQ install"
    return 0
  }

  if command -v workiq >/dev/null 2>&1; then
    _agents_log "updating WorkIQ"
  else
    _agents_log "installing WorkIQ"
  fi

  NPM_CONFIG_PREFIX="$npm_prefix" npm install -g @microsoft/workiq \
    || _agents_warn "WorkIQ install failed; continuing"
}

_agents_install_or_update_opencode() {
  if [ -n "${DOTFILES_SKIP_AGENT_INSTALL:-}" ]; then
    return 0
  fi

  if ! _agents_is_agent_host; then
    _agents_log "skipping OpenCode install outside managed agent hosts"
    return 0
  fi

  if _agents_is_macos; then
    if command -v opencode >/dev/null 2>&1; then
      _agents_log "OpenCode already available"
      return 0
    fi
    _agents_brew_install opencode || _agents_warn "OpenCode install failed; continuing"
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    _agents_warn "curl unavailable; skipping OpenCode install"
    return 0
  fi

  if command -v opencode >/dev/null 2>&1; then
    _agents_log "updating OpenCode"
    opencode upgrade || _agents_warn "OpenCode upgrade failed; continuing"
    return 0
  fi

  _agents_log "installing OpenCode"
  bash -lc 'curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path' \
    || _agents_warn "OpenCode install failed; continuing"
}

_agents_main() {
  local root failures=0
  root="$(_agents_root)"

  _agents_link_global_agents "$root" || failures=$((failures + 1))
  _agents_link_pi_agent "$root" || failures=$((failures + 1))
  _agents_remove_stale_extension_link "$root" "projects.ts" || failures=$((failures + 1))
  _agents_remove_stale_extension_link "$root" "worktree.ts" || failures=$((failures + 1))
  _agents_link_opencode_config "$root" || failures=$((failures + 1))
  _agents_ensure_agent_tools || failures=$((failures + 1))
  _agents_ensure_gh_slack || failures=$((failures + 1))
  _agents_install_or_update_opencode || failures=$((failures + 1))
  _agents_install_or_update_pi || failures=$((failures + 1))
  _agents_setup_cmux_pi_hooks || failures=$((failures + 1))
  _agents_install_or_update_workiq || failures=$((failures + 1))

  if [ "$failures" -gt 0 ]; then
    _agents_warn "completed with $failures non-fatal issue(s)"
  fi

  _agents_print_warning_summary
}

_agents_main "$@"
