# Context

Glossary of domain terms used in this repository.

## Workflows

### Org-required workflow
A workflow file in this repo whose **path** is referenced by an organization-level GitHub Ruleset, making it a required check for every repo in the org. Because the ruleset references the file by path on `main`, the file path is a load-bearing contract — renaming or moving it breaks enforcement across the org. Current examples: `self-zizmor.yaml`, `org-required-trufflehog.yml`.

### Activation gate
The first job in an org-required workflow whose only purpose is to decide whether the rest of the workflow runs. Cheap, fast, and always exits green. Used because the ruleset applies to *every* repo in the org (Go, Python, mixed) and the workflow must not noisily fail on repos it doesn't apply to. Downstream jobs use `if: needs.<gate>.outputs.<signal> == 'true'`.

## Supply-chain workflow

### Static check
A check that depends only on files committed to the repository — no network, no advisory database. Same input ⇒ same output, always. **Blocking**: a violation fails the workflow and (via the ruleset) blocks merge. Examples: "is `.npmrc` present and correct?" (JS), "is the lockfile committed?" (JS), "is `go.sum` committed?" (Go), "is the Go toolchain pinned?" (Go).

### Advisory check
A check whose result depends on external state (registry, advisory database, time of day). The same commit can pass on Monday and fail on Friday because a new CVE was published overnight. **Non-blocking**: surfaces via PR comment to nudge the author, but `continue-on-error: true` keeps it from gating merge. Examples: `pnpm audit` (JS), `govulncheck` (Go).

### Ecosystem
A language/package-manager world the workflow knows how to inspect. Today: `js` (Node.js — npm / pnpm / yarn) and `go` (Go modules). Each ecosystem has its own walker, its own checks, and its own root type. The engine pairs a check with a root only when the ecosystems match, so a JS check never runs against a Go module and vice versa. Adding a new ecosystem (Python, Rust, …) means a new walker, a new root variant, and a new `checks/<eco>/` directory — not a plugin system.

### Manifest
The file the walker keys on to discover roots. Ecosystem-specific:
- **JS**: `package.json`
- **Go**: `go.mod`

The presence of *any* manifest of *any* known ecosystem activates the supply-chain workflow.

### Root
A manifest that is **not** a workspace member of any ancestor manifest *in the same ecosystem*. In a workspace monorepo, the workspace root is the root and its workspace members are not. In a repository with several independent projects sharing a tree, each project's top-level manifest is a root. Checks operate at root granularity.

A repository can contain roots from **multiple** ecosystems simultaneously (e.g. a Go service with a JS UI in `web/`). Each set is discovered and checked independently.

### Workspace member
A manifest at path `P` such that some ancestor manifest declares `P` as a workspace. The mechanism is ecosystem-specific:
- **JS**: npm/yarn `"workspaces": [...]` in `package.json`, or pnpm `pnpm-workspace.yaml` listing `packages:`
- **Go**: `go.work` listing `use ./moduleX` directives

Workspace members do not have their own lockfile or version-pin file — those are inherited from the workspace root. Most supply-chain checks skip workspace members.

### Per-root walk
Strategy for handling monorepos: discover every manifest, classify each as root or workspace member, then run checks against the **roots only**. Findings are keyed by root path. A violation in any root fails the workflow. Replaces the naive "per-manifest" walk, which would produce false positives in workspace monorepos.

### Lockfile conflict
*(JS-only.)* A root containing more than one lockfile (e.g. both `package-lock.json` and `pnpm-lock.yaml`). Almost always indicates a half-finished migration. Treated as a **hard fail** — the workflow refuses to guess which manager rules to apply, and the developer must resolve it explicitly. Go has only one lockfile format (`go.sum`), so this term doesn't apply on the Go side.

## Reporting

### Finding
The atomic unit a check produces. Stable shape used by every check and the report renderer:
- `check_id` — stable identifier (e.g. `npmrc-min-release-age`); never renamed once shipped, because future suppression and metrics key on it.
- `severity` — `blocking` or `advisory`. Blocking failures fail the workflow; advisory ones only surface in the report.
- `root` — the root path the finding applies to (`.` for single-package repos, `apps/frontend` etc. for monorepos).
- `title`, `detail`, `fix`, `doc_link` — human-facing text.

### Sticky comment
The single PR comment the supply-chain workflow maintains, identified by an HTML comment marker (`<!-- supply-chain-report-v1 -->`). On each run the workflow finds the existing comment by marker and updates it in place rather than creating a new one. Keeps PR thread quiet across multi-push iterations.

### Report
The aggregated rendering of all findings for a workflow run. Mirrored identically into the sticky PR comment and the GitHub Step Summary. Sections (in order):
1. **Top-line status** — ✅ all passed, or ❌ N blocking / M advisory
2. **Blocking violations** — expanded
3. **Advisory findings** — expanded
4. **Passing checks** — collapsed by default
5. **Footer** — link to the workflow run

In monorepos, findings are **grouped by root** inside each section, not flat.

### Suppression
A documented exemption that allows a specific check to be reported as "suppressed" rather than "blocking" or "advisory" on a specific repository. Lives in `.github/supply-chain.yml` in the target repo. Required fields per entry: `check_id` and `reason`. Optional: `expires` (ISO date — past that, the suppression is ignored and the check fires normally). Suppressed findings **still appear in the report** under a dedicated "Suppressed" section — they are never silently dropped. Suppressing a check requires committing the suppression file, which is auditable in git history.
