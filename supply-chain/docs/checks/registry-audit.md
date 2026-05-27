# `registry-audit`

**Severity:** advisory

## What this check verifies

Runs the package manager's audit command (`npm audit` / `pnpm audit` /
`yarn npm audit`) against each root and emits an advisory finding when
the audit reports **high** or **critical** severity vulnerabilities.

Lower severities (moderate, low, info) are not surfaced — the comment
fatigue cost exceeds the actionable signal for advisory-grade output.

## Why this is advisory (and not blocking)

Advisory databases are mutable — a CVE published overnight can take a
previously-passing commit and make it fail. Blocking on this would mean
unrelated PRs go red on a Friday afternoon with no code change required.
See [ADR-0001](../adr/0001-single-workflow-two-jobs.md).

## How to fix

```bash
# from the root that flagged
npm audit fix          # for npm
pnpm audit             # for pnpm — investigate each advisory
yarn npm audit --recursive --all
```

For transitive vulnerabilities that have no fix yet, you have three
options:

1. **Wait** — usually a fix lands within days.
2. **Override the resolution** — npm/pnpm/yarn each have a manifest field
   for forcing a specific transitive version (`overrides`, `pnpm.overrides`,
   `resolutions`).
3. **Suppress the check** with an `expires:` date so it un-suppresses once
   you've had time to fix.

## When audit can't run

If the audit command itself fails (network error, registry timeout, missing
binary), this check emits a *single* advisory finding rather than crashing.
Audit failures don't block other findings from being reported.

## Suppressing

```yaml
suppressions:
  - check_id: registry-audit
    reason: "Pinned to <pkg> 1.2.3 due to <reason>; advisory not actionable today."
    expires: 2026-08-01
```
