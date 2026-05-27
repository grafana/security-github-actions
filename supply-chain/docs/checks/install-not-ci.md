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

`npm install` and friends will happily resolve to newer-than-locked versions
under permissive ranges. In CI this means two builds of the same commit can
install different code. `npm ci` / `--immutable` / `--frozen-lockfile`
refuse to do that, aborting on lockfile drift.

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
