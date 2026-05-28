# `lockfile-conflict`

**Severity:** critical

## What this check verifies

A root must contain **exactly one** lockfile. Finding more than one
(`package-lock.json` *and* `pnpm-lock.yaml`, etc.) at the same root
is a hard fail.

## Why we check this

A root with two lockfiles is **silently insecure** in a way that's hard
for a reviewer to notice.

### The ambiguity attackers exploit

If `package-lock.json` and `pnpm-lock.yaml` both exist at the same root:

- The developer's laptop probably uses pnpm (`pnpm install`) and ignores
  `package-lock.json`.
- A CI step that runs `npm ci` (because someone copy-pasted a template
  workflow) installs from the *other* lockfile — the one nobody ever
  audits or updates.
- The two lockfiles will inevitably drift. The one nobody uses *stays
  pinned at whatever an old, possibly-compromised commit set it to*.
  When a future workflow accidentally runs `npm ci`, that lockfile is
  what gets installed.

### Why our checks can't proceed safely

Most other checks key on `packageManager:` to pick which rules to apply
(`.npmrc` vs `pnpm-workspace.yaml` vs `.yarnrc.yml`). If the manifest
says pnpm but the repo has a `package-lock.json` alongside the
`pnpm-lock.yaml`, *we genuinely don't know* whether the hardening should
apply to one, the other, or both. Picking one and proceeding would let
the unaudited lockfile coast through without the controls we promise.
Failing fast is safer.

### The doc is explicit

The hardening guide says "always commit the lockfile" — the singular is
load-bearing.

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
