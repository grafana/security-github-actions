# Per-root walk, workspace-aware

Checks operate on **roots** — manifests that are not workspace members of any ancestor — rather than on every `package.json` in the tree. A naive per-manifest walk would emit dozens of false positives in any workspace monorepo (every workspace child would flag "no lockfile next to me"). The activation gate still triggers on the presence of any `package.json` anywhere, because gating on lockfile presence would hide the "lockfile missing" failure mode the workflow is meant to catch.

## Consequences

- The walker must understand all three workspace conventions: npm `"workspaces": [...]`, yarn `"workspaces": [...]`, pnpm `pnpm-workspace.yaml`.
- When a root contains more than one lockfile, it's a hard fail (lockfile conflict) — the workflow refuses to guess which manager rules apply.
- The package manager for a root is determined by the `packageManager:` field; a missing field is itself a critical finding (we don't fall back to lockfile detection).
