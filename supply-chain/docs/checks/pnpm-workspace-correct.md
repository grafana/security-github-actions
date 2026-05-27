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

pnpm is the most-recommended package manager in the org guide because its
default posture is **already** the safest of the three (post-install
scripts are off by default, for instance). These three required keys
close the remaining gaps.

### `minimumReleaseAge: 4320` — 3-day install cooldown

4320 minutes = 3 days, exactly matching npm's `min-release-age=3` and
yarn's `npmMinimalAgeGate: 4320`.

Malicious package versions are typically detected and unpublished within
hours-to-days of release. The 3-day gate sits inside that detect-and-yank
window: a fresh malicious patch published this morning won't be installed
by any CI run before Thursday, by which time the community has likely
noticed and npm has unpublished it.

3 days matches the org's default Renovate config, so dependency-update
PRs are not affected by the gate.

### `strictDepBuilds: true` — fail on unknown build scripts

Since pnpm 10, **scripts are blocked by default** (the pnpm equivalent of
npm's `ignore-scripts=true`, but always on). You allowlist specific
packages that genuinely need a build step via `allowBuilds:`:

```yaml
allowBuilds:
  esbuild: true
  rolldown: true
```

By default, pnpm only **warns** when an un-allowlisted package wants to
build. `strictDepBuilds: true` upgrades that warning to a hard install
failure — so adding a new dependency that ships a `postinstall` script
breaks `pnpm install` until someone explicitly reviews and allowlists it.

This converts "I'll deal with that warning later" into "the install
fails, I have to look at this now." That's exactly the human-in-the-loop
moment we want for any package that wants to run code during install.

### `blockExoticSubdeps: true` — block transitive git/tarball deps

A malicious top-level dependency can declare a *git URL* or a *direct
tarball URL* for one of its own dependencies. That transitive dependency
then bypasses every registry safety net (no malware scan, no provenance,
mutable target) — even though it's not visible in your `package.json`.

`blockExoticSubdeps: true` (pnpm ≥ 10.26) refuses to install any
transitive dep declared with a non-registry source. This is the pnpm
equivalent of npm's `allow-git=none`, but covers the transitive case
specifically — exactly the case a human reviewer is least likely to
notice during PR review.

### Why we leave `allowBuilds:` and `trustPolicy:` flexible

`allowBuilds:` is necessarily team-specific (your tree of deps determines
what needs to build). `trustPolicy: no-downgrade` is widely recommended
but not strictly required.

The three keys we *do* enforce — release-age, strict builds,
exotic-subdep blocking — are universal: they should be on for every
pnpm project regardless of what's in the tree.

### Reference

See [pnpm's supply-chain security guide](https://pnpm.io/supply-chain-security)
for the underlying mechanics.

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
