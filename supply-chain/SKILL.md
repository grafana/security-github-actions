---
name: supply-chain
description: Run the grafana org's supply-chain checks against a Node.js repository and apply the suggested fixes. Use when the user says "check supply chain", "fix supply chain", "audit supply chain", "/check-npm", "/supply-chain", or asks about Node.js supply-chain hardening for a specific repo. The skill wraps `npm run check` in `grafana/security-github-actions/supply-chain/` and walks the agent through fixing each finding.
---

# Supply-chain check & fix

Run the supply-chain check against a target Node.js repository and walk the user through fixing every blocking and advisory finding.

## Locate the CLI

Default path: `~/dev/security-github-actions/supply-chain`.

If that directory doesn't exist:

1. Ask the user where their clone of `grafana/security-github-actions` is.
2. If they don't have one, propose `git clone https://github.com/grafana/security-github-actions ~/dev/security-github-actions` and proceed once they accept.

Verify `package.json` and `src/check.ts` exist under the CLI dir. If `node_modules/` is missing, run `npm install` in the CLI dir first (one-time setup; only devDependencies — `typescript` and `@types/node`).

## Determine the target

First positional argument the user provides → resolve to absolute path. If they gave none, use the current working directory.

If the target has no `package.json` anywhere, the CLI exits cleanly with "checks skipped." Report that and stop — there's nothing to do.

## Run the check

From the CLI directory, write JSON findings to a known path:

```bash
cd <CLI-DIR>
mkdir -p ~/.cache/supply-chain-skill
SUPPLY_CHAIN_FINDINGS_OUT=~/.cache/supply-chain-skill/findings.json \
  npm run check --silent -- <target>
```

The CLI exits 1 when there are blocking findings — that's expected; **don't treat exit 1 as an error**. Always read the JSON afterwards.

JSON shape (see `supply-chain/src/io.ts`):

```json
{
  "ran": ["packagemanager-pinned", "..."],
  "findings": [
    { "check_id": "...", "severity": "blocking" | "advisory",
      "root": ".", "title": "...", "detail": "...",
      "fix": "...", "doc_link": "..." }
  ],
  "suppressed": [...]
}
```

## Mode flags

Useful flags to pass after the `--` separator:

- `--no-audit` — skip the network-dependent `registry-audit` check (offline, faster). Use this when the user is iterating on static fixes.
- `--audit-only` — only run the audit (after fixing static issues, before a release).

## Present and fix

Show the user a one-line summary: `N blocking, M advisory across K roots`. Then for each finding, in order (blocking first, then advisory, grouped by `root`):

1. **Read the canonical fix guide** at `<CLI-DIR>/docs/checks/<ecosystem>/<check_id>.md` — `<ecosystem>` is `js` for npm/pnpm/yarn checks (`lockfile-committed`, `npmrc-correct`, etc.) or `go` for the Go ones (`gosum-committed`, `go-toolchain-pinned`, `govulncheck-clean`). The doc has the "Why," the precise fix recipe, and important subtleties (e.g. "even an empty list is a violation" for `yarnrc-correct`'s `approvedGitRepositories`). Always read this before acting — the `fix:` field on the finding is a one-liner; the doc has the full picture. The finding's `doc_link` field is also a direct URL to this same file, if you'd rather follow that.

2. **Inspect the target's current state** of the files the fix would touch. Don't assume the file is missing just because a key is missing — partial configs are common.

3. **Choose an approach** based on whether the fix is mechanical or judgement-needed:

   **JS checks**

   | Check | Mechanical → apply directly | Judgement → ask first |
   |---|---|---|
   | `npmrc-correct` | ✅ add/fix keys in `.npmrc` | |
   | `pnpm-workspace-correct` | ✅ add/fix keys in `pnpm-workspace.yaml` | |
   | `yarnrc-correct` | ✅ add/fix keys; remove `approvedGitRepositories` block | |
   | `packagemanager-pinned` | ✅ add the field at the minimum version | bumping major versions if pinning to existing higher version |
   | `lockfile-committed` | needs `npm/pnpm/yarn install` + `git add` — confirm before running install | |
   | `lockfile-conflict` | | ✅ ask which manager to keep |
   | `install-not-ci` | ✅ rewrite each occurrence to the strict form | |
   | `npx-confusion` | | ✅ ask for the correct package/scope per occurrence |
   | `oidc-publishing` | | ✅ workflow restructure + registry-side trust config — guide, don't auto-edit |
   | `cache-poisoning-publish` | ✅ add `package-manager-cache: false` to setup-node | |

   **Go checks**

   | Check | Mechanical → apply directly | Judgement → ask first |
   |---|---|---|
   | `gosum-committed` | needs `go mod tidy` + `git add go.sum` — confirm before running | |
   | `go-toolchain-pinned` | ✅ add `toolchain go1.<minor>.<patch>` directive to `go.mod` | bumping a major from below 1.22 if the team has reasons to stay older |
   | `govulncheck-clean` | ✅ when the finding includes `fixedVersion`, run `go get <module>@<version>` then `go mod tidy` | when no fix exists — guide the user on workarounds (avoid the symbol, override) |

4. **Apply the fix** with the `Edit` tool. Reference the finding's `doc_link` in your commit message / progress note if you're producing one.

5. **Track progress** — for multi-finding runs, use a TodoWrite list with one entry per finding so the user can see what's done.

## Re-run to verify

After applying fixes, re-run the same command and confirm the findings cleared. If new findings appeared (fixing one config exposed another), iterate — typically one more pass clears them.

Report the final state: `passed`, or `still N blocking / M advisory` with the remaining list.

## Suppression instead of fix

If a check can't be fixed for a legitimate reason (vendored upstream code, intentional non-compliance with a tracked plan to fix later), guide the user to commit `.github/supply-chain.yml` in the **target** repo (not the CLI dir):

```yaml
suppressions:
  - check_id: <id>
    reason: "<short justification>"
    expires: 2026-12-31   # optional but encouraged
```

Each `docs/checks/<ecosystem>/<id>.md` has a "Suppressing" section with the exact entry for that check.

## When NOT to use this skill

- The user asks how the checks work *in general* (no target repo) → just point them to `<CLI-DIR>/README.md` and the per-check docs under `docs/checks/js/` and `docs/checks/go/`.
- The user asks about CI configuration or the workflow file → that's a different concern; refer to `<CLI-DIR>/docs/adr/` and the `.github/workflows/supply-chain.yaml`.
