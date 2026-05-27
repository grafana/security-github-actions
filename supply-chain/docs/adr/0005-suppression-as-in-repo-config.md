# Suppression lives in the target repo's `.github/supply-chain.yml`

A repository that needs to opt a specific check out of blocking commits a `.github/supply-chain.yml` listing the suppressed `check_id`s. Each entry requires a free-text `reason:` and may carry an `expires:` ISO date (past which the suppression is ignored). Suppressed findings still surface in the report under a "Suppressed" section — they are never silently dropped, and the suppression file itself is auditable in git history.

## Considered

- **No escape hatch at all.** Rejected: politically untenable at org scale. Within a week of rollout some team will have a legitimate exemption and "no hatch" will be replaced with whatever lazy thing the first person on call invents under pressure. Better to ship a known shape now.
- **Per-repo blanket opt-out via topic / setting.** Rejected: exempts the entire repo and produces no per-repo audit trail.

## Consequences

- The `check_id` field on findings is now a public contract. Suppressions reference it by string; renaming a `check_id` after shipping breaks suppressions silently. New rule: `check_id`s are append-only — to retire one, mark it deprecated and ignore in the engine, but never rename or reuse the string.
- Suppressions accumulate. The `expires:` field is the primary defence; without it suppressions live forever. The README must call out the periodic-review pattern (e.g. quarterly).
