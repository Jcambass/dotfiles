# Dotfiles

Your dotfiles are how you personalize your system. These are mine.

I was a little tired of having long alias files and everything strewn about
(which is extremely common on other dotfiles projects, too). That led to this
project being much more topic-centric. I realized I could split a lot of things
up into the main areas I used (Ruby, git, system libraries, and so on), so I
structured the project accordingly.

If you're interested in the philosophy behind why projects like these are
awesome, you might want to [read my post on the
subject](http://zachholman.com/2010/08/dotfiles-are-meant-to-be-forked/).

## topical

Everything's built around topic areas. If you're adding a new area to your
forked dotfiles — say, "Java" — you can simply add a `java` directory and put
files in there. Anything with an extension of `.zsh` will get automatically
included into your shell. Anything with an extension of `.symlink` will get
symlinked without extension into `$HOME` when you run `script/bootstrap`.

## what's inside

A lot of stuff. Seriously, a lot of stuff. Check them out in the file browser
above and see what components may mesh up with you.
[Fork it](https://github.com/holman/dotfiles/fork), remove what you don't
use, and build on what you do use.

## per system setup

These dotfiles are split based on three different machine types I use:
- `macos` for my personal MacBook Pro
- `codespaces` for my GitHub Codespaces
- `bpdev` for bpdev machines

Each of these machine types has a directory in the root of the dotfiles.
We always only operate on the directory for the machine type we are currently
on. This is determined by the `DOTFILES_MACHINE_TYPE` environment variable.

In addition to the machine type, there is a `common` directory that contains files that are shared between at least two of the machine types.

The `script/common-link` script can be used to add and remove topic directories from the `common` directory to the machine type directories. This is done via symlinks so that changes to the shared files are automatically reflected in all machine types. The symlinked folders will be prefixed with `common-` in the machine type directories. This allows us to easily see what is shared and what is not but also allows us to have a machine type specific folder with the same name as a common folder.

## components

Each system specific directory, including `common` can the following type of components:

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

Files (except for `bin` files) can also be placed in the system specific directory directly. This should be used sparingly and only for simple files that are self describing.

## install

Run this:

```sh
git clone https://github.com/holman/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
script/bootstrap
```

This will symlink the appropriate files in `.dotfiles` to your home directory.
Everything is configured and tweaked within `~/.dotfiles`.

The main file you'll want to change right off the bat is `zsh/zshrc.symlink`,
which sets up a few paths that'll be different on your particular machine.

`dot` is a simple script that installs some dependencies, sets sane macOS
defaults, and so on. Tweak this script, and occasionally run `dot` from
time to time to keep your environment fresh and up-to-date. You can find
this script in `bin/`.
