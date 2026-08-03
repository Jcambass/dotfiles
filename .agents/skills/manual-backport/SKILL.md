---
name: manual-backport
description: Manually backport a merged PR to release branches when GitHub's release-controller bot reports a merge conflict and posts cherry-pick instructions as a PR comment.
---

# Manual backport

Use this when a merged PR has one or more `release-controller` bot comments
titled "Merge Conflict: `enterprise-X.Y-release`", each with a "Manual
Backport Instructions" section. Branches without a conflict get backported
automatically by the bot; only commented-on branches need manual work.

## Find the work

```bash
gh pr view <PR> --repo <owner>/<repo> --json comments \
  -q '.comments[] | select(.author.login == "release-controller") | .body'
```

Each comment gives you, for one release branch: the existing backport branch
name (already created by the bot), the exact merge commit SHA to cherry-pick,
the required commit message, and a `gh`-independent compare URL with a
pre-filled PR title that must not be edited (it drives backport tracking
automation) and body.

## Workflow per branch

1. Fetch and check out the existing backport branch (created by the bot),
   tracking the remote — don't invent a new branch name:
   ```bash
   git worktree add -b <backport-branch> ../repo-backport-<slug> origin/<backport-branch>
   cd ../repo-backport-<slug>
   git fetch origin master --quiet
   ```
2. Cherry-pick with `-m 1` (the PR's merge commit has multiple parents; `-m 1`
   replays it against the release branch's own mainline):
   ```bash
   git cherry-pick -m 1 <merge-commit-sha>
   ```
3. Resolve conflicts (see below).
4. Verify (see below).
5. `git add` the resolved files, then commit with **the exact message the bot
   gave you** — don't paraphrase, it's used for tracking:
   ```bash
   git commit -m "Manual backport of #<PR> - resolved conflict"
   ```
6. Push and open the PR with the bot's exact title/body, base = the release
   branch, head = the backport branch:
   ```bash
   git push --set-upstream origin <backport-branch>
   gh pr create --repo <owner>/<repo> --base <release-branch> --head <backport-branch> \
     --title "<exact title from the bot comment>" --body "Manual backport of #<PR>"
   ```
7. Repeat for every commented branch, each in its own worktree (or reuse one
   worktree sequentially, one branch at a time, if you prefer fewer directories).

## Resolving conflicts safely

Release branches drift independently over time (most repos have no
cross-branch config sync), so a conflict is often *not* two versions of the
same idea fighting — it's the release branch's own unrelated, older content
colliding with new context lines the merge machinery can't place. Before
resolving, understand what the *original PR actually changed* semantically,
then reapply just that against the release branch's existing state. Don't
assume the release branch's surrounding content is wrong just because it
differs from the default branch.

### `go.mod` / `go.sum` / `vendor/modules.txt`

1. Resolve `go.mod` by hand: keep the release branch's own pre-existing
   requires untouched, apply only the specific semantic change the PR made
   (e.g. remove one require line, promote specific packages from indirect to
   direct). Check exactly what the ported/moved code imports with a grep
   before deciding what to promote — don't guess from the default branch's
   `go.mod`, which may include unrelated newer dependencies the release
   branch doesn't have at all:
   ```bash
   grep -rhoE '"[a-zA-Z0-9./_-]+"' path/to/moved/code --include="*.go" | sort -u
   ```
2. **Never run `go mod tidy` to resolve a backport conflict.** It re-runs
   minimal version selection across the whole graph and can silently bump
   unrelated transitive dependencies many versions forward (seen in
   practice: an unrelated `go.opentelemetry.io/otel` bump from v1.28.0 to
   v1.44.0) — well outside the scope of a mechanical backport.
3. Instead, run `go mod vendor` only. It downloads exactly what your
   hand-resolved `go.mod` declares without re-resolving versions:
   ```bash
   git checkout --ours go.sum vendor/modules.txt   # discard conflict markers, start clean
   go mod vendor
   ```
4. If a module's checksums are now unused (e.g. the module being inlined),
   `go mod vendor` won't prune `go.sum` — remove its lines by hand for a
   clean diff:
   ```bash
   sed -i '' '/github.com\/the\/removed-module/d' go.sum
   ```

### `dependabot.yml` and other shared config

Reconstruct precisely what the original PR added/removed, and reapply just
that, leaving every other pre-existing entry on the release branch alone —
even if it looks inconsistent with the default branch (different docker
entry style, missing gomod section, etc.). That inconsistency is normal,
pre-existing drift, not something to fix as part of a backport. If the
conflict cut a multi-line entry in half (git's context matching can leave a
trailing block like `schedule:` orphaned on the wrong side), reread the
surrounding lines carefully after resolving and make sure nothing is
duplicated or missing.

### Multi-block conflicts and script-based resolution

If you resolve conflicts with a script (e.g. a regex over `<<<<<<< / ======= /
>>>>>>>` markers) instead of by hand, verify it first:

- Count `<<<<<<<` occurrences with `grep -c` and confirm your script finds
  the same number of blocks.
- A non-greedy regex that assumes a newline always separates the "theirs"
  content from the `>>>>>>>` marker will silently swallow through to the
  *next* conflict block whenever "theirs" is empty (a common case — HEAD
  added something the incoming side didn't touch at all). Match up to the
  `>>>>>>>` literal instead of requiring a preceding newline in the pattern.
- Print every matched block before applying and read them; don't trust a
  script blindly on `go.mod`-shaped files where a merged/incomplete block is
  easy to miss until the build fails in some unrelated way (or, worse,
  doesn't fail, but silently ships a wrong dependency version).

## Verify before pushing

```bash
go build ./...
go vet ./...
go test --tags static ./...

# Confirm the actual build/ship step still produces exactly what's expected —
# this catches vendor/module problems that `go build` alone can miss.
TMPBIN=$(mktemp -d)
GOBIN="$TMPBIN" go install ./cmd/... ./cmd-libexec/...
ls "$TMPBIN"
rm -rf "$TMPBIN"
```

## Notes

- Opening the backport PR is separate from getting it merged — it still
  needs review like any other PR.
- If the source PR's approvals were dismissed by a force-push during review
  (see the `git` skill on branch protection / `dismiss_stale_reviews_on_push`),
  that's unrelated to backporting; each backport PR collects its own reviews.
- `git cherry-pick --abort` and retry freely while you're still figuring out
  the right resolution — nothing is pushed until you explicitly push.
