# `yarnrc-correct`

**Severity:** blocking · **Applies to:** yarn roots

## What this check verifies

For every yarn root, `.yarnrc.yml` must contain three required keys at
the expected values **and** must not contain one forbidden key.

Required (one finding per missing or wrong-valued):

```yaml
enableScripts: false
enableImmutableInstalls: true
npmMinimalAgeGate: 4320
```

Forbidden (one finding if present):

```yaml
approvedGitRepositories: ...   # the key being present at all is a violation
```

`npmMinimalAgeGate` is treated as a **minimum**: any value ≥ 4320 passes.
A team that wants a longer cooldown (e.g. `10080` for 1 week) is more
strict, not less, and is not flagged. The two boolean keys are exact-match.

## Why we check this

Three keys to enable, one key whose **mere presence** is a violation —
the last point is the one most reviewers miss.

### `enableScripts: false` — disable post-install hooks

This is the yarn equivalent of npm's `ignore-scripts=true`. Same attack,
same mitigation: post-install hooks run untrusted code on `yarn install`
before any of your tests have a chance to scrutinize what's in the tree.
The historical incidents (`event-stream`, `ua-parser-js`, etc.) all
exploit this mechanism, and Yarn projects are equally vulnerable unless
this knob is flipped.

For yarn, this isn't on by default. You have to set it.

### `enableImmutableInstalls: true` — fail on lockfile drift

A "drift" attack:

1. Attacker compromises a maintainer of a transitive dep.
2. They publish a malicious patch that satisfies an existing semver range.
3. CI runs `yarn install` (not `yarn install --immutable`).
4. Yarn quietly updates the lockfile in place to pick up the new version.
5. The malicious code runs, the lockfile change is committed by a release
   automation that doesn't review diffs, and now the repo is on the
   poisoned version permanently.

`enableImmutableInstalls: true` makes yarn **refuse** to modify the
lockfile during install — drift becomes a hard error. The committed
lockfile is the source of truth, period.

### `npmMinimalAgeGate: 4320` — 3-day install cooldown

4320 minutes = 3 days. Same rationale as npm's `min-release-age=3` and
pnpm's `minimumReleaseAge`: most malicious package versions are detected
and unpublished within hours-to-days of release; a 3-day gate sits inside
that window so your CI never resolves to a freshly-poisoned version.

3 days matches the org's default Renovate config, so dependency-update
PRs flow normally.

### `approvedGitRepositories` — forbidden, even empty

Yarn 4.14+ blocks all git-source dependencies by default. The
`approvedGitRepositories` key is the **escape hatch** that re-enables
them for specific repos.

The org guide is explicit: **never set this key**. Quote from the
hardening doc:

> Do not under any circumstances add `approvedGitRepositories` to this
> file. It is a security risk that would allow arbitrary code execution
> both locally and in CI.

Even an empty list (`approvedGitRepositories: []`) is treated as a
violation by this check, because:
- The key being present means somebody is *thinking about* using it.
- An empty list today becomes a non-empty list tomorrow when a PR adds
  "just one" trusted repo, which then becomes the precedent for the
  next, and the next.
- The safe state is "the key does not exist in the file."

If you genuinely need a fork, vendor it or publish it to a private
registry — same advice as npm's `allow-git=none`.

## How to fix

Create or edit `.yarnrc.yml`:

```yaml
# Do not under any circumstances add approvedGitRepositories to this file.
# See https://yarnpkg.com/configuration/yarnrc#approvedGitRepositories
enableScripts: false
enableImmutableInstalls: true
npmMinimalAgeGate: 4320

# Optional: bypass the age gate for specific grafana packages, if needed.
# npmPreapprovedPackages:
#   - "@grafana/<name-of-package>"
```

If the check is firing on `approvedGitRepositories`, remove the entire
block.

## Suppressing this check

```yaml
suppressions:
  - check_id: yarnrc-correct
    reason: "<your reason>"
    expires: 2026-12-31
```
