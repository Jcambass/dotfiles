# Pi sandbox image

`docker-pi build` uses this Dockerfile for the Pi sandbox image.

From any shell that sources `.shellrc`:

```bash
docker-pi build
```

`docker-pi` also builds the image on first run if it does not exist yet:

```bash
pi
```

Useful overrides:

```bash
PI_DOCKER_IMAGE=pi-sandbox-test docker-pi build
PI_DOCKERFILE=/path/to/Dockerfile.pi docker-pi build
```

The image includes Go, Ruby, Python, Rust, Docker, and a source-built `gh-slack` executable on `PATH` for the GitHub CLI extension. `docker-pi` starts a nested Docker daemon by default using `--privileged` and stores its state in the `pi-docker-lib` Docker volume. Set `PI_DOCKER_IN_DOCKER=0` to disable this.

The sandbox mounts Pi configuration, `~/.gitconfig`, and `~/.ssh` read-only from the host, but keeps Pi state in the `pi-agent-home` Docker volume. For SSH, `docker-pi` overlays a generated Linux-compatible `/root/.ssh/config` that expands `Include` files, removes macOS-only options such as `UseKeychain`, and rewrites absolute host-home paths to `/root`. It also forwards `SSH_AUTH_SOCK` when an agent is available, so encrypted keys can keep using the host agent. This keeps host keys and aliases available in the container without committing machine-local SSH details. Set `PI_DOCKER_SSH_CONFIG=0` to disable the SSH mount, or `PI_DOCKER_SSH_AGENT=0` to disable agent forwarding.

`docker-pi` also mounts the host Slack app configuration read-only at `/root/.config/Slack` when it exists, so `gh-slack` can find the usual cookie database path. On macOS, Slack cookies are often encrypted with the macOS keychain and cannot be decrypted by the Linux container from the mount alone. To avoid that, `docker-pi` runs `gh-slack auth -t github` on the host during startup, then passes only `SLACK_TOKEN` and `SLACK_COOKIES` into the temporary container. Bootstrap installs the host `gh-slack` command on macOS.

No Slack secrets are printed or stored in the repository. Set `PI_DOCKER_SLACK_AUTH=0` to disable Slack auth forwarding, `PI_DOCKER_SLACK_TEAM=<team>` to use a different Slack team, `PI_DOCKER_SLACK_CONFIG=0` to disable the Slack configuration mount, or `PI_DOCKER_SLACK_DIR=/path/to/Slack` to override the host Slack directory.

Symlinked configuration paths are resolved before mounting. For directories that contain symlinked files, such as `~/.agents/skills`, `docker-pi` also mounts the symlink target repository read-only so those files are readable inside the container.

Pi defaults to GitHub Copilot models, but model auth is still Pi state. On first
use, run `pi`, type `/login`, choose GitHub Copilot, and leave the Enterprise
domain blank unless you need one. That auth is stored in the `pi-agent-home`
Docker volume.

bpdev runs Pi natively and does not use this Docker sandbox.
