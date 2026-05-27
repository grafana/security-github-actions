# `lockfile-conflict`

**Severity:** blocking

## What this check verifies

A root must contain **exactly one** lockfile. Finding more than one
(`package-lock.json` *and* `pnpm-lock.yaml`, etc.) at the same root
is a hard fail.

## Why we check this

A root with multiple lockfiles almost always means a half-finished
migration between package managers. None of the downstream checks can
behave correctly: which manager rules apply? `.npmrc` or
`pnpm-workspace.yaml`? Rather than guess and silently pick one — risking
hardening controls being applied against the wrong manager — we refuse
to proceed.

The doc is also explicit that "always commit the lockfile" means the
*one* lockfile, not two competing ones.

## How to fix

Decide which package manager you are actually using and delete the
lockfile(s) for the others. Make sure `packageManager:` in `package.json`
matches the one you keep.

```bash
# example: keeping pnpm
git rm package-lock.json yarn.lock
# ensure package.json has "packageManager": "pnpm@…"
git commit
```

## Suppressing this check

Strongly discouraged — a multi-lockfile root is unsafe by design. If you
have a one-off reason (e.g. mid-migration with a hard deadline), use a
short `expires:`:

```yaml
suppressions:
  - check_id: lockfile-conflict
    reason: "Mid-migration to pnpm; tracked in <ticket>"
    expires: 2026-06-15
```
