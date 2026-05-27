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

## Why we check this

- `enableScripts: false` — disables post-install hooks; the yarn
  equivalent of npm's `ignore-scripts=true`.
- `enableImmutableInstalls: true` — refuses installs that would modify
  the lockfile (catches drift in CI).
- `npmMinimalAgeGate: 4320` — 3-day cooldown; matches npm's
  `min-release-age=3` and pnpm's `minimumReleaseAge`.
- `approvedGitRepositories` (forbidden) — its very presence is a
  vulnerability: it allows arbitrary code execution both locally and in
  CI by trusting specific git repos as install sources. Even an empty
  list is a violation; the safe state is "the key does not exist."

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
