# Single workflow file with two jobs (static-blocking + audit-advisory)

The supply-chain workflow ships as **one** workflow file (`.github/workflows/supply-chain.yaml`) containing two jobs: a static-check job that fails the workflow on violation (and therefore blocks merge via the org ruleset), and an `npm/pnpm audit` job with `continue-on-error: true` that runs at PR time and posts findings into the sticky PR comment without gating merge. We picked one file over two because the user wanted both checks to feel like the same surface; the cost is that `continue-on-error: true` on the audit job is the only line of defence against an advisory CVE turning into an org-wide merge freeze on a Friday afternoon.

## Consequences

- The `continue-on-error: true` flag on the audit job is load-bearing. Any future PR that removes it silently elevates `npm audit` to a required check across the org. CODEOWNERS should require security review for changes to `.github/workflows/supply-chain.yaml`.
- The ruleset references the workflow file's path on `main`. Renaming or moving this file breaks enforcement org-wide.
