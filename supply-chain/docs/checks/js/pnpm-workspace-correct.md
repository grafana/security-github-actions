# `pnpm-workspace-correct`

**Severity:** critical · **Applies to:** pnpm roots

## What this check verifies

For every pnpm root, `pnpm-workspace.yaml` must contain:

```yaml
strictDepBuilds: true
```

One finding is emitted if the file is missing, the key is missing, or
the value is anything other than `true`.

> **Scope note (PR1):** this check ships in a reduced form.
> `minimumReleaseAge: 4320` and `blockExoticSubdeps: true` from the org
> hardening guide are enforced in a follow-up PR — for now,
> `pnpm-workspace-correct` covers post-install-script disabling only.

## Why we check this

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

See [pnpm's supply-chain security guide](https://pnpm.io/supply-chain-security)
for the underlying mechanics.

## How to fix

Create or edit `pnpm-workspace.yaml` at the root that flagged:

```yaml
strictDepBuilds: true
```

## Suppressing this check

```yaml
suppressions:
  - check_id: pnpm-workspace-correct
    reason: "<your reason>"
    expires: 2026-12-31
```
