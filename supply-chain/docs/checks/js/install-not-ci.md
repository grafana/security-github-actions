# `install-not-ci`

**Severity:** advisory

## What this check verifies

Scans GitHub workflows, Dockerfile(s), Makefile, Tiltfile, mise.toml, and
root `*.sh` for `npm install` / `yarn install` / `pnpm install` calls that
are **not** in the lockfile-strict form:

| Manager | Lockfile-strict form |
|---|---|
| npm | `npm ci` |
| yarn | `yarn install --immutable` (with optional `--immutable-cache`) |
| pnpm | `pnpm install --frozen-lockfile` |

One finding per offending line.

## Why we check this

A committed lockfile is only as good as the install command that consumes
it. `npm install` and friends are **happy to ignore the lockfile** —
they treat it as a hint, not an obligation. If a `package.json` range is
permissive, the install will quietly resolve to a newer version than the
lockfile pinned and *modify the lockfile in place* on disk.

### The attack this closes

A drift attack works like this:

1. Attacker compromises a transitive maintainer and publishes a
   malicious patch that satisfies an existing semver range somewhere
   deep in your tree.
2. CI runs `npm install` (not `npm ci`).
3. npm picks up the new patch, installs the malicious code, and
   silently rewrites `package-lock.json`.
4. If your CI commits regenerated lockfiles (release automation, some
   Renovate setups), the poisoned version is now your committed lockfile.

`npm ci` / `pnpm install --frozen-lockfile` / `yarn install --immutable`
**refuse** to deviate from the committed lockfile. If the install would
need to write to it, the command aborts with an error. The lockfile
becomes the actual source of truth, not a suggestion.

### Why this is advisory, not critical

A repo can have a perfect `.npmrc` / `pnpm-workspace.yaml` / `.yarnrc.yml`
and still have one `npm install` hidden in a Dockerfile or a Tiltfile —
that's the kind of thing that's easy to miss in review. Surfacing each
occurrence as an advisory finding lets the team see the inventory
without blocking merge. Promote to critical on a per-repo basis once
you've cleared the existing instances.

### Files scanned

`.github/workflows/*.{yml,yaml}`, `Dockerfile` (and `Dockerfile.*`),
`Makefile`, `Tiltfile`, `mise.toml`, and root-level `*.sh`. See the
[scanner module](../../src/scanner.ts) for the exact list.

## How to fix

Replace the offending command. Examples:

```diff
- - run: npm install
+ - run: npm ci

- - run: pnpm install --no-frozen-lockfile
+ - run: pnpm install --frozen-lockfile
```

## Suppressing

```yaml
suppressions:
  - check_id: install-not-ci
    reason: "<your reason>"
    expires: 2026-12-31
```
