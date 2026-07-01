# Dotfiles

## per system setup

These dotfiles are split based on three different machine types I use:
- `macos` for my personal MacBook Pro
- `codespaces` for my GitHub Codespaces
- `bpdev` for bpdev machines

Each machine type has a manifest in `systems/` that lists the topic directories
enabled for that environment. `script/bootstrap` writes the detected
`DOTFILE_SYSTEM_TYPE` to `.system`, reads `systems/$DOTFILE_SYSTEM_TYPE`, then
links and installs only the topics listed there.

In addition to the machine type, there is a `common` directory that contains files that are shared between at least two of the machine types.

The `script/common-link` script adds and removes common topics from those
manifests:

```sh
script/common-link add git macos
script/common-link remove git macos
```

You can also edit `systems/macos`, `systems/bpdev`, or `systems/codespaces`
directly. The entries are repo-relative topic paths, which keeps each
environment explicit and avoids `common-*` symlink indirection.

## components

Each manifest topic directory can contain the following components:

- **topic/install.sh**: Any file named `install.sh` is executed when you run `script/install`. To avoid being loaded automatically, its extension is `.sh`, not `.zsh`.
- **topic/\*.symlink**: Any file ending in `*.symlink` gets symlinked into
  your `$HOME`. This is so you can keep all of those versioned in your dotfiles
  but still keep those autoloaded files in your home directory. These get
  symlinked in when you run `script/bootstrap`.
- **topic/bin/**: Anything in `bin/` will get added to your `$PATH` and be made
  available everywhere.
- **topic/\*.env**: Any file ending in `.env` is loaded first and is
  expected to setup `$PATH` or similar environment variables.

Some files are depending on the shell being used.

For `zsh`:
- **topic/\*.zsh**: Any files ending in `.zsh` get loaded into your
  environment.
- **topic/completion.zsh**: Any file named `completion.zsh` is loaded
  last and is expected to setup autocomplete.

For `bash`:
- **topic/\*.bash**: Any files ending in `.bash` get loaded into your
  environment.

System-specific topics live under their system directory, like
`macos/homebrew` or `bpdev/vscode-extensions`. Shared topics live under
`common/`.

## install

Run this:

```sh
git clone https://github.com/jcambass/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
script/bootstrap
```

This will symlink the appropriate files in `.dotfiles` to your home directory.
Everything is configured and tweaked within `~/.dotfiles`.

macOS, bpdev, and Codespaces also link the shared agent configuration:

- `~/.agents` for global agent instructions and skills.
- `~/.pi/agent` for Pi agents, prompts, settings, and extensions.
- `~/.config/opencode/opencode.json` for OpenCode defaults.
- `~/.local/bin` as the npm prefix for Pi installs.

`.agents` and `.pi/agent` are managed by the `common/agents` component like any
other dotfiles component; they just link into nested config paths instead of
directly into `$HOME`.

macOS, bpdev, and Codespaces are all first-class agent environments. Bootstrap
installs the core agent toolchain automatically with Homebrew on macOS and
`sudo apt-get` on bpdev/Codespaces: `git`, `gh`, `jq`, `ripgrep`, `tmux`,
Node.js/npm, Pi, OpenCode, WorkIQ, and `pup`. macOS also installs cmux and
OrbStack when they are missing. bpdev and Codespaces run Pi natively; macOS uses
the Docker-backed `docker-pi` sandbox by default.

The main file you'll want to change right off the bat is `zsh/zshrc.symlink`,
which sets up a few paths that'll be different on your particular machine.

`dot` is a simple script that installs some dependencies, sets sane macOS
defaults, and so on. Tweak this script, and occasionally run `dot` from
time to time to keep your environment fresh and up-to-date. You can find
this script in `bin/`.
