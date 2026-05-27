# `pnpm-workspace-correct`

**Severity:** blocking · **Applies to:** pnpm roots

## What this check verifies

For every pnpm root, `pnpm-workspace.yaml` must contain all three required
keys at the expected values:

```yaml
minimumReleaseAge: 4320
strictDepBuilds: true
blockExoticSubdeps: true
```

One **finding per missing or wrong-valued key**.

`allowBuilds:` and `trustPolicy:` are allowed but not required — different
teams will have different lists; the org guide allows them but doesn't
mandate specific contents.

## Why we check this

- `minimumReleaseAge: 4320` — 4320 minutes = 3 days, equivalent to npm's
  `min-release-age=3`. Refuses to install package versions less than three
  days old.
- `strictDepBuilds: true` — fails install on unknown build scripts rather
  than warning. Combined with `allowBuilds:`, this enforces explicit
  allowlisting of which packages may run install scripts.
- `blockExoticSubdeps: true` — blocks transitive git/tarball dependencies,
  the pnpm equivalent of npm's `allow-git=none`.

## How to fix

Create or edit `pnpm-workspace.yaml` at the root that flagged. A complete
recommended file:

```yaml
packages:
  - "apps/*"
  - "packages/*"

minimumReleaseAge: 4320
trustPolicy: no-downgrade
allowBuilds:
  esbuild: true
  rolldown: true
strictDepBuilds: true
blockExoticSubdeps: true
```

## Suppressing this check

```yaml
suppressions:
  - check_id: pnpm-workspace-correct
    reason: "<your reason>"
    expires: 2026-12-31
```
