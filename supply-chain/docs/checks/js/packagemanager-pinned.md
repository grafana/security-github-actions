# `packagemanager-pinned`

**Severity:** critical

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

This check **gates every other check in the workflow**. Two reasons:

### 1. Hardening features are version-dependent

The org's hardening controls landed in specific package-manager releases:

| Control | Required version |
|---|---|
| npm `allow-git=none` (block git deps) | npm ≥ 11.10 |
| npm `min-release-age` (3-day cooldown) | npm ≥ 11.10 |
| OIDC trusted publishing via `npm publish` | npm ≥ 11.10 |
| pnpm `blockExoticSubdeps` (block transitive git/tarball deps) | pnpm ≥ 10.26 |
| pnpm `minimumReleaseAge` | pnpm ≥ 10 |
| pnpm `strictDepBuilds` (fail-not-warn on unknown build scripts) | pnpm ≥ 10 |
| Yarn `approvedGitRepositories` (block git deps by default) | Yarn ≥ 4.14 |
| Yarn `npmMinimalAgeGate` (release-age gate) | Yarn ≥ 4.10 |

On an older manager, these config keys are **silently ignored**. The
hardening looks correct in the file but provides zero protection at
install time. An attacker who can publish a malicious version still gets
to run on every developer machine and every CI run, just like before
hardening was "added."

That's the worst kind of security control: one that exists in
configuration but not in reality.

### 2. The workflow can't apply the right rules without it

`packageManager:` is how this workflow knows which manager you use. We
use that to pick the right config-file rules (`.npmrc` vs
`pnpm-workspace.yaml` vs `.yarnrc.yml`), the right install command for
`install-not-ci`, and the right audit command for `registry-audit`.

The lockfile alone is ambiguous: a monorepo with `pnpm-lock.yaml` at the
root and a sub-project containing only `package.json` is impossible to
classify without the explicit manager declaration.

### Bonus: Corepack pins for free

Once `packageManager:` is set, [Corepack](https://nodejs.org/api/corepack.html)
installs the **exact** version (down to the integrity hash) on every
developer machine and CI runner. That eliminates a class of "works on
mine, breaks on yours" issues entirely, and the Corepack hash itself
becomes part of your supply-chain attestation.

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
