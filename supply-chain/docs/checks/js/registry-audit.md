# `registry-audit`

**Severity:** advisory

## What this check verifies

Runs the package manager's audit command (`npm audit --json` /
`pnpm audit --json` / `yarn npm audit --recursive --all --json`) against
each root and emits **one finding per high or critical advisory** with
the affected package, advisory title, vulnerable version range, and a
direct link to the GHSA / CVE page.

Lower severities (moderate, low, info) are not surfaced — the
comment-fatigue cost exceeds the actionable signal for advisory-grade
output.

To keep the report readable on repos with many advisories, output is
**capped at 20 advisories per root** (critical first, then high,
alphabetical within severity). When the cap kicks in, a single summary
finding tells you how many more exist and how to view the full list
locally.

### Example output

A finding looks like:

> **lodash (critical): Prototype Pollution in lodash**
> Vulnerable: `<4.17.21` · Patched: `>=4.17.21`
> Fix: Update `lodash` to satisfy `>=4.17.21`.
> [Docs](https://github.com/advisories/GHSA-35jh-r3h4-6jhm) · `registry-audit`

The doc link is the **advisory's own URL** when available — that page
has the upstream maintainer's full mitigation guidance, which is far
more authoritative than anything we could duplicate here.

## Why we check this

Every other check in this workflow is about **prevention** — making sure
a malicious package can't make it into your tree in the first place
(via post-install hooks, git deps, lockfile drift, etc.). This check is
the only one about **detection**: surfacing vulnerabilities that are
*already in your tree* because they were known when (or after) you
installed them.

The two postures complement each other:

- Prevention checks (`npmrc-correct`, `lockfile-committed`, etc.) keep
  *future* bad things out.
- This check tells you what's *already there* so you can decide whether
  to bump, override, or accept.

Without an audit step, even a perfectly-hardened repo silently
accumulates known CVEs as the advisory database grows around its frozen
lockfile.

### Why we only surface high + critical

`npm audit` will happily report dozens of low/moderate advisories that
are usually transitive, often not exploitable in your particular usage,
and never get fixed. Surfacing them all turns the comment into wallpaper
and trains people to ignore it. High + critical is the threshold that
typically maps to "real, exploitable risk in real applications."

### Why this is advisory (not critical)

Advisory databases are mutable. A CVE published overnight can take a
previously-passing commit and make it fail — with no code change on
the PR. Critical on this would mean unrelated PRs go red on a Friday
afternoon while the developer who wrote the PR has zero context for the
failure. See [ADR-0001](../adr/0001-single-workflow-two-jobs.md) for the
"static critical, dynamic advisory" split rationale.

### Why this runs in its own CI job

Unlike every other check, `registry-audit` needs **network access** to
the registry to fetch the advisory database. That's why it lives in a
separate `audit` job from the offline-clean `static` job. The two jobs
write JSON payloads that the `report` job merges into one sticky PR
comment — so the user sees a unified result even though the production
path is two parallel jobs.

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
