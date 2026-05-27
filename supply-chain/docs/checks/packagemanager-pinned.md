# `packagemanager-pinned`

**Severity:** blocking

## What this check verifies

For every root in your repository, `package.json` must declare a
`"packageManager"` field with one of the supported managers at a version
new enough to support the org's hardening controls:

| Manager | Minimum version |
|---|---|
| `npm` | 11.10.0 |
| `pnpm` | 11.0.0 |
| `yarn` | 4.14.0 |

The Corepack integrity suffix (`+sha256.…`) is accepted and ignored for
version comparison.

## Why we check this

Two reasons:

1. **The hardening controls themselves are version-dependent.** Yarn's
   `approvedGitRepositories` requires Yarn ≥ 4.14, npm's `allow-git=none`
   requires npm ≥ 11.10, pnpm's `blockExoticSubdeps` requires pnpm ≥ 11.
   Without these versions, the rest of the workflow's checks have no
   teeth — the config keys would simply be ignored.
2. **`packageManager:` is the canonical way the workflow knows which manager
   you use.** Without it, we cannot select the right check rules to apply
   (npmrc vs pnpm-workspace.yaml vs .yarnrc.yml). The lockfile alone is
   ambiguous in monorepos with multiple package managers nearby.

## How to fix

Add the field to your root `package.json`:

```json
{
  "name": "your-package",
  "packageManager": "pnpm@11.5.0"
}
```

Pick the value matching the manager you actually use. Corepack will then
install that exact version on every developer machine and in CI without
any extra configuration.

## Suppressing this check

Suppressing this check disables nearly every other check in the workflow
(because we can't know which rules apply), so it's strongly discouraged.
If you have a legitimate need, the suppression entry is:

```yaml
suppressions:
  - check_id: packagemanager-pinned
    reason: "Repo is intentionally manager-agnostic; document why."
    expires: 2026-12-31
```
