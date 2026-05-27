# `npmrc-correct`

**Severity:** blocking · **Applies to:** npm roots

## What this check verifies

For every npm root, the root-level `.npmrc` file must contain all three
required keys at the expected values:

```
ignore-scripts=true
allow-git=none
min-release-age=3
```

One **finding is emitted per missing or wrong-valued key**, so a fresh
repo with no `.npmrc` will get three findings telling you exactly what to add.

## Why we check this

Each key blocks one supply-chain attack vector:

- `ignore-scripts=true` — disables post-install hooks, the dominant
  attack vector. A malicious dependency cannot run code on `npm install`.
- `allow-git=none` — blocks `git+https://` dependencies, which skip
  registry malware scanning and provenance checks.
- `min-release-age=3` — refuses to install package versions less than
  three days old. Most malicious versions are unpublished within hours
  of discovery; the cooldown means you never resolve to them.

## How to fix

Create or edit `.npmrc` at the root that flagged:

```
ignore-scripts=true
allow-git=none
min-release-age=3
```

Comments (`#`) and blank lines are allowed. The order doesn't matter.

## Suppressing this check

```yaml
suppressions:
  - check_id: npmrc-correct
    reason: "Vendored upstream config conflicts; tracked in <ticket>"
    expires: 2026-12-31
```
