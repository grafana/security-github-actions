---
name: mitigate-supply-chain
description: Run the grafana org's supply-chain checks against a Node.js repository and apply the suggested fixes. Use when the user says "check supply chain", "fix supply chain", "audit supply chain", "mitigate supply chain", "/mitigate-supply-chain", or "/check-npm" (legacy alias), or asks about supply-chain hardening for a specific repo. The skill wraps `npm run check` in `grafana/security-github-actions/supply-chain/` and walks the agent through fixing each finding.
---

# Supply-chain check & fix

Run the supply-chain check against a target Node.js repository and walk the user through fixing every critical finding.

> **Scope note (PR1):** the CLI currently ships only the four post-install-script-disabling checks (`packagemanager-pinned`, `npmrc-correct`, `pnpm-workspace-correct`, `yarnrc-correct`). Other checks listed in earlier drafts (lockfile, install-not-ci, npx-confusion, OIDC, cache-poisoning, registry-audit, Go support) ship in follow-up PRs.

## Locate the CLI

Default path: `~/dev/security-github-actions/supply-chain`.

If that directory doesn't exist:

1. Ask the user where their clone of `grafana/security-github-actions` is.
2. If they don't have one, propose `git clone https://github.com/grafana/security-github-actions ~/dev/security-github-actions` and proceed once they accept.

Verify `package.json` and `src/check.ts` exist under the CLI dir. If `node_modules/` is missing, run `npm install` in the CLI dir first (one-time setup; only devDependencies — `typescript` and `@types/node`).

## Determine the target

First positional argument the user provides → resolve to absolute path. If they gave none, use the current working directory.

The CLI activates if any `package.json` is present in the tree. If none exists, the CLI exits cleanly with "checks skipped." Report that and stop — there's nothing to do.

## Run the check

From the CLI directory, write JSON findings to a known path:

```bash
cd <CLI-DIR>
mkdir -p ~/.cache/mitigate-supply-chain
SUPPLY_CHAIN_FINDINGS_OUT=~/.cache/mitigate-supply-chain/findings.json \
  npm run check --silent -- <target>
```

The CLI exits 1 when there are critical findings — that's expected; **don't treat exit 1 as an error**. Always read the JSON afterwards.

JSON shape (see `supply-chain/src/io.ts`):

```json
{
  "ran": ["packagemanager-pinned", "..."],
  "findings": [
    { "check_id": "...", "severity": "critical" | "advisory",
      "root": ".", "title": "...", "detail": "...",
      "fix": "...", "doc_link": "..." }
  ],
  "suppressed": [...]
}
```

## Present and fix

Show the user a one-line summary: `N critical across K roots`. Then for each finding, in order (grouped by `root`):

1. **Read the canonical fix guide** at `<CLI-DIR>/docs/checks/js/<check_id>.md`. The doc has the "Why," the precise fix recipe, and important subtleties. Always read this before acting — the `fix:` field on the finding is a one-liner; the doc has the full picture. The finding's `doc_link` field is also a direct URL to this same file.

2. **Inspect the target's current state** of the files the fix would touch. Don't assume the file is missing just because a key is missing — partial configs are common.

3. **Choose an approach** based on whether the fix is mechanical or judgement-needed:

   | Check | Mechanical → apply directly | Judgement → ask first |
   |---|---|---|
   | `npmrc-correct` | ✅ add/fix `ignore-scripts=true` in `.npmrc` | |
   | `pnpm-workspace-correct` | ✅ add/fix `strictDepBuilds: true` in `pnpm-workspace.yaml` | |
   | `yarnrc-correct` | ✅ add/fix `enableScripts: false` in `.yarnrc.yml` | |
   | `packagemanager-pinned` | ✅ add the field at the minimum version | bumping major versions if pinning to an existing higher version |

4. **Apply the fix** with the `Edit` tool. Reference the finding's `doc_link` in your commit message / progress note if you're producing one.

5. **Track progress** — for multi-finding runs, use a TodoWrite list with one entry per finding so the user can see what's done.

## Re-run to verify

After applying fixes, re-run the same command and confirm the findings cleared. If new findings appeared (fixing one config exposed another), iterate — typically one more pass clears them.

Report the final state: `passed`, or `still N critical` with the remaining list.

## Suppression instead of fix

If a check can't be fixed for a legitimate reason (vendored upstream code, intentional non-compliance with a tracked plan to fix later), guide the user to commit `.github/supply-chain.yml` in the **target** repo (not the CLI dir):

```yaml
suppressions:
  - check_id: <id>
    reason: "<short justification>"
    expires: 2026-12-31   # optional but encouraged
```

Each `docs/checks/js/<id>.md` has a "Suppressing" section with the exact entry for that check.

## When NOT to use this skill

- The user asks how the checks work *in general* (no target repo) → just point them to `<CLI-DIR>/README.md` and the per-check docs under `docs/checks/js/`.
- The user asks about CI configuration or the workflow file → that's a different concern; refer to `<CLI-DIR>/docs/adr/` and the `.github/workflows/supply-chain.yaml`.
