# PR1 check scope: post-install-script enforcement only

PR1 ships a deliberately narrow subset of the org hardening guide: the
four checks needed to enforce **post-install-script disabling** across
the three supported package managers.

| check_id | What it enforces |
|---|---|
| `packagemanager-pinned` | `package.json` declares `packageManager:` at org-policy versions. Required as the gate — without it, the other three checks skip on repos that don't declare a manager, so the post-install-script enforcement would be bypassable. |
| `npmrc-correct` | `.npmrc` contains `ignore-scripts=true`. |
| `pnpm-workspace-correct` | `pnpm-workspace.yaml` contains `strictDepBuilds: true`. |
| `yarnrc-correct` | `.yarnrc.yml` contains `enableScripts: false`. |

All four are **critical** (workflow fails → merge blocked).

## Why this scope

Disabling post-install scripts is the single highest-impact mitigation
in the entire hardening guide: it defeats the dominant npm supply-chain
attack vector (`event-stream`, `ua-parser-js`, `node-ipc`,
`@solana/web3.js`, the `nx` post-install miner all run their payload
through this mechanism). Landing this enforcement first — across all
three managers — produces immediate, measurable risk reduction across
the org before any of the other (more invasive, more
false-positive-prone) checks are introduced.

## What is *not* in PR1

The rest of the hardening guide ships in follow-up PRs:

- **PR2** adds the remaining JS checks: `lockfile-committed`,
  `lockfile-conflict`, the full `.npmrc` / `.yarnrc.yml` /
  `pnpm-workspace.yaml` keysets (cooldowns, git-source blocking, etc.),
  the heuristic checks (`install-not-ci`, `npx-confusion`,
  `oidc-publishing`, `cache-poisoning-publish`), and the network-backed
  `registry-audit` check.
- **PR3** adds Go-ecosystem support (`gosum-committed`,
  `toolchain-pinned`, `govulncheck-clean`) and the structural split into
  `src/js/` + `src/go/`.

## Considered

- **Ship everything at once.** Rejected: the unified PR is ~3kLOC of
  net-new code across two ecosystems and ten ADRs, which is harder to
  review and harder to roll back if any single check turns out to be a
  source of false positives at org scale. A three-PR split lets each
  layer settle before the next lands.
- **Drop `packagemanager-pinned` from PR1.** Rejected: the three
  manager-specific checks gate on `root.packageManager` and skip when
  the field is missing. Without `packagemanager-pinned` flagging the
  missing field, a repo that simply omits `packageManager:` would
  bypass the post-install enforcement entirely.

## Consequences

- The CLI's check registry stores severity per check (not derived).
  Promoting an advisory check to critical in a future PR is a one-line
  change, but it remains a deliberate org-wide event with a grace
  period (see README rollout section).
- Minimum version constants (npm ≥ 11.10, pnpm ≥ 11, yarn ≥ 4.14.0)
  live in source as named constants; bumping them is the same kind of
  deliberate event.
