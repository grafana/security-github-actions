# V1 check scope: which checks block, which only advise

> **Update:** `node-version-pinned` (Check 6) was subsequently removed
> entirely — see [ADR-0008](./0008-remove-node-version-pinned.md). The
> rationale below for demoting it to advisory is preserved for context.


The critical set (workflow fails → merge blocked) is restricted to checks whose findings are unambiguous: read one well-known file, compare to an expected value, pass or fail with no judgement call. These are checks 1–5 and 7 from the hardening guide: `.npmrc` correct, `pnpm-workspace.yaml` correct, `.yarnrc.yml` correct, lockfile committed, `packageManager:` pinned + recent, lockfile conflict. The advisory set (PR comment only) is the heuristic checks 8–11 (install-not-ci, OIDC publishing, npx confusion, cache poisoning), the audit checks 13–14, and check 6 (Node version pinned + recent). Check 12 (shrink the dep tree) is dropped — there is no machine-checkable rule.

## Considered

- **All seven of 1–7 critical, including Node version.** Rejected: bumping Node major versions is genuinely non-trivial work (deps, breaking changes), and failing Check 6 does not directly compromise the supply-chain mitigations themselves (an old Node still respects `ignore-scripts`). Demoted to advisory.
- **Heuristic checks 8–11 critical from v1.** Rejected: a required check that fires false positives 5% of the time will get every team building escape hatches within a week. Start advisory, graduate individual checks to critical after we have real-world FP signal.

## Consequences

- The CLI's check registry stores severity per check, not derived. Promoting an advisory check to critical is a one-line change, but it is a deliberate org-wide event with a grace period (see README rollout section).
- Minimum version constants (npm ≥ 11.10, pnpm ≥ 11, yarn ≥ 4.14.0, Node ≥ 24.5.0) live in source as named constants; bumping them is the same kind of deliberate event.
