# Supply-chain hardening workflow

An organization-required GitHub Actions workflow that statically checks each
repository for the Node.js supply-chain hardening controls described in
[the org hardening guide](https://example.invalid/hardening-guide).

If your PR fails the **Supply-chain hardening / Static checks** job, this is
the place to find out what to do.

## TL;DR

The workflow scans your repository for `package.json` files. If it finds any,
it runs a set of static checks against each "root" (a manifest that is not a
workspace member). Failures appear in:

- the **GitHub Step Summary** of the workflow run, and
- a **sticky PR comment** that updates on every push (see [milestone status](#milestones))

If the workflow says you have a **critical** finding, you must fix it (or
file a [suppression](#suppressions)) before merge. **Advisory** findings
appear in the same comment but do not block merging.

You can also run the exact same checks on a local clone — no CI needed:
`cd supply-chain && npm install && npm run check -- /path/to/repo`. See
[Running it locally](#running-it-locally-against-a-local-clone-no-ci-required).

## What gets checked

### Critical (fail merge if violated)

| ID | What it checks |
|---|---|
| `packagemanager-pinned` | `package.json` declares `packageManager:` at or above the minimum version. |
| `lockfile-committed` | The lockfile for the declared package manager exists and is committed. |
| `lockfile-conflict` | A root contains at most one lockfile (no half-finished migrations). |
| `npmrc-correct` | npm roots have a complete `.npmrc` with `ignore-scripts`, `allow-git`, `min-release-age`. |
| `pnpm-workspace-correct` | pnpm roots have `pnpm-workspace.yaml` with `minimumReleaseAge`, `strictDepBuilds`, `blockExoticSubdeps`. |
| `yarnrc-correct` | yarn roots have `.yarnrc.yml` with `enableScripts: false`, `enableImmutableInstalls`, `npmMinimalAgeGate`, and no `approvedGitRepositories`. |

### Advisory (PR comment only, never blocks merge)

| ID | What it checks |
|---|---|
| `install-not-ci` | Workflows / Dockerfiles / Tiltfile / Makefile / mise.toml / shell scripts use the lockfile-strict install command (`npm ci`, `--frozen-lockfile`, `--immutable`). |
| `npx-confusion` | `npx <name>` invocations use either an allowlisted bare name, a scoped name, or `--package`. |
| `oidc-publishing` | Workflows that call `npm/pnpm/yarn publish` use OIDC trusted publishing (`id-token: write`, no long-lived tokens). |
| `cache-poisoning-publish` | Publishing workflows disable `actions/setup-node`'s package-manager cache. |
| `registry-audit` | Surfaces high/critical advisories from `npm/pnpm/yarn audit`. |

### Go (both ecosystems run in the same workflow)

| ID | Severity | What it checks |
|---|---|---|
| `gosum-committed` | critical | `go.sum` is present + tracked by git for any module with `require` entries. |
| `go-toolchain-pinned` | critical | `go.mod` declares a `toolchain` directive at Go ≥ 1.22.0; `go` directive also ≥ 1.22.0. |
| `govulncheck-clean` | advisory | Surfaces **call-reachable** vulnerabilities from `govulncheck -json` (only flags vulns your code actually executes — not noisy graph-level reports). |

See [docs/checks/](./docs/checks/) for the per-check fix guide. Each finding
in the PR comment links to its check's doc page directly. The ecosystem
split rationale lives in [ADR-0009](./docs/adr/0009-add-go-support.md).

## How activation works

The workflow applies the **activation gate** before running anything:

- If your repo has **no `package.json` and no `go.mod`** anywhere, the
  workflow exits clean. Repos in other ecosystems (Python, Rust, etc.)
  pass through silently.
- If either signal is found, the workflow walks the tree, classifies each
  manifest / module as a **root** or a **workspace member**, and runs the
  ecosystem-appropriate checks against the roots only.

In JS monorepos (npm/yarn `"workspaces"` or `pnpm-workspace.yaml`), only
the workspace root receives root-level checks. Workspace members do not.
In Go monorepos, `go.work` plays the same role — modules declared via
`use ./moduleX` are workspace members of the `go.work` root.

A repository can contain **both** ecosystems (e.g. a Go service with a
small JS UI). Both walkers run; each set of checks applies to its own
roots independently.

## Suppressions

If you have a legitimate reason a specific check cannot pass on your repo,
commit `.github/supply-chain.yml` listing the check IDs you want to suppress:

```yaml
suppressions:
  - check_id: lockfile-committed
    reason: "Upstream vendor doesn't ship a lockfile; we mirror as-is."
    expires: 2026-12-31   # optional but encouraged — past this date the suppression is ignored
```

Suppressed findings still appear in the PR comment under the **Suppressed**
section. They are never silently dropped, and the suppression file itself is
audited in git history.

> **Note:** the suppression mechanism is **specified but not yet implemented**.
> See [milestone status](#milestones) below.

## Excluding paths from the walker

If your repo contains `package.json` files that are *not* real projects
(throwaway fixtures, vendored copies the workflow shouldn't inspect),
commit a `.supply-chain-check-ignore` file at the repository root, listing
one directory prefix per line:

```
# Throwaway fixture manifests used only by unit tests.
tests/fixtures
```

## What I want to ship vs. what I'm shipping today

### Milestones

The workflow ships incrementally. Where each capability is on the curve:

| Capability | Status |
|---|---|
| Workspace-aware walker | ✅ shipped |
| All critical checks | ✅ shipped |
| Heuristic advisory checks (`install-not-ci`, `npx-confusion`, `oidc-publishing`, `cache-poisoning-publish`) | ✅ shipped |
| Workflow file at `.github/workflows/supply-chain.yaml` | ✅ shipped |
| Sticky PR comment | ✅ shipped |
| Suppression mechanism (`.github/supply-chain.yml`) | ✅ shipped |
| `registry-audit` advisory (run `npm/pnpm/yarn audit` in a dedicated job, merged into the unified comment) | ✅ shipped |

## Running it locally (against a local clone, no CI required)

You don't need a GitHub Actions runner to use this. The same checks run from a
single `npm run check` command against any local directory.

### Prerequisites

- Node.js ≥ 24.5.0 (for native TypeScript execution)
- `npm install` once in `supply-chain/` to fetch dev dependencies (`typescript`, `@types/node`)

### Usage

```bash
# from inside the security-github-actions repo:
cd supply-chain
npm install            # one-time, fetches typescript + @types/node only

# Check the surrounding repository (the default):
npm run check

# Check a specific local clone:
npm run check -- /path/to/some/other/repo

# Skip the network-dependent registry-audit check (faster, works offline):
npm run check -- --no-audit /path/to/some/repo
```

### Output format

**Default local run** (in a terminal): you get the full text report on
stdout *and* an HTML report at `~/.cache/supply-chain/report-<timestamp>.html`
that's auto-opened in your default browser. The path is also printed on
stderr as a clickable `file://` URL.

Force a different stdout format explicitly:

```bash
npm run check -- --format=text /path/to/repo        # ANSI-coloured (default in TTY)
npm run check -- --format=markdown /path/to/repo    # raw markdown, for paste
npm run check -- --format=html /path/to/repo        # HTML only — no terminal text
```

Opt-out flags:

```bash
npm run check -- --no-html /path/to/repo            # skip the HTML file entirely
npm run check -- --no-open /path/to/repo            # write HTML but don't auto-open
```

When stdout is **piped** (`npm run check > out.md`), the HTML side is
disabled regardless — only the chosen format reaches stdout.

The HTML report is fully self-contained: inlined CSS, no JS, no external
assets. Findings render as a responsive 2-column grid (3 columns on wide
displays). Respects `prefers-color-scheme` for light/dark.

Colors in terminal output honour `NO_COLOR` and `FORCE_COLOR` automatically.

### Exit codes

- **0** — no critical findings (advisory findings are allowed and printed)
- **1** — at least one critical finding
- **2** — unexpected error (parse crash, etc.)

### Pre-rollout org survey

Loop over many clones to see what would happen if the org ruleset were flipped
today — same code as the CI workflow, no CI needed:

```bash
mkdir -p /tmp/sc-scan && cd /tmp/sc-scan
for repo in $(gh repo list grafana --limit 100 --json nameWithOwner -q '.[].nameWithOwner'); do
    gh repo clone "$repo" "${repo##*/}" -- --depth 1 2>/dev/null || continue
    echo "=== $repo ==="
    ( cd ~/dev/security-github-actions/supply-chain && \
      npm run check --silent -- --no-audit "/tmp/sc-scan/${repo##*/}" ) | head -30
done
```

`--no-audit` is recommended for surveys: it keeps the loop fast and avoids
hammering the registry with audit requests.

## For developers of this tool

```bash
cd supply-chain
node --version            # must be >= 24.5.0
npm install               # devDependencies only (typescript, @types/node)
npm test                  # 75 fixture-driven unit tests
npm run check             # dogfood against the surrounding repo
```

### Layout

The repo is split by ecosystem. The top level of each of `src/`, `tests/`,
and `docs/checks/` holds only **ecosystem-agnostic** code (engine, report,
suppressions, …); ecosystem-specific code lives under `js/` or `go/`.

```
supply-chain/
  CONTEXT.md              # domain glossary
  README.md
  package.json
  tsconfig.json
  src/
    # reusable
    types.ts              # Finding, Check, Root, RepoContext (discriminated union)
    engine.ts             # walk + run checks + apply suppressions
    report.ts             # markdown renderer
    text-report.ts        # terminal renderer
    check.ts              # single CLI entry point (used in CI + locally)
    registry.ts           # single source of truth for which checks exist
    io.ts, render-cli.ts, post-comment.ts, suppressions.ts
    # JS-specific
    js/
      walk.ts             # discoverJsRoots()
      scanner.ts          # workflow/Dockerfile/etc. scanner for heuristic checks
      _audit-parse.ts, _config-helpers.ts
      lockfile-committed.ts, npmrc-correct.ts, …
    # Go-specific
    go/
      walk.ts             # discoverGoRoots()
      _govulncheck-parse.ts
      gosum-committed.ts, toolchain-pinned.ts, govulncheck-clean.ts
  tests/
    # reusable
    io.test.ts, suppressions.test.ts, text-report.test.ts
    js/
      walk.test.ts, lockfile-committed.test.ts, audit-parse.test.ts, …
      fixtures/<check>/<good|bad-*>/...
    go/
      walk.test.ts, checks.test.ts, govulncheck-parse.test.ts
      fixtures/<check>/<good|bad-*>/...
  docs/
    adr/                  # architecture decision records (cross-ecosystem)
    checks/
      js/<check_id>.md    # per-check fix guide
      go/<check_id>.md
```

### Workflow architecture (3 jobs, 1 CLI)

The workflow runs three jobs that fan-in to a single sticky comment, all driven
by **the same** `src/check.ts` invoked with different mode flags:

```
              ┌─────────────────────────────────────┐  static-findings.json
              │ static                               │
              │   check.ts --no-audit                │──────────────┐
              │   (critical → exit 1)                │              │
              └─────────────────────────────────────┘              ▼
detect ──┬─►                                                 ┌──────────┐
         │    ┌─────────────────────────────────────┐        │ report   │
         │    │ audit                                │  audit │          │
         └─►  │   check.ts --audit-only              │──────► │          │
              │   (continue-on-error: true)          │        └──────────┘
              └─────────────────────────────────────┘        render-cli.ts
                                                              + post-comment.ts
```

- **`static`** runs `check.ts --no-audit`. Every non-network check across all roots. Its **non-zero exit on critical findings is what fails the workflow** and gates merge. Writes `static-findings.json`.
- **`audit`** runs `check.ts --audit-only`. Only `registry-audit`. **Always advisory** at the job level (`continue-on-error: true` — ADR-0001). Writes `audit-findings.json`.
- **`report`** depends on `[static, audit]` with `if: always()`. Downloads both artifacts, runs `render-cli.ts` to merge the payloads and produce one markdown body, then `post-comment.ts` posts/updates the sticky PR comment.

The same `check.ts` (with no flags) is what runs locally via `npm run check`. CI mode vs local mode is determined entirely by environment variables: if `SUPPLY_CHAIN_FINDINGS_OUT` or `GITHUB_STEP_SUMMARY` is set, it writes to those; otherwise it prints the rendered markdown to stdout.

### Adding a new check

The ecosystem of the new check (`js` or `go`) determines which subdirectory
each artifact lands in. Substitute `<eco>` accordingly below.

1. Decide the `check_id` — it is **append-only** once shipped. Suppressions
   reference it by string forever. See [ADR-0005](./docs/adr/0005-suppression-as-in-repo-config.md).
2. Add `src/<eco>/<check_id>.ts` exporting `check: NodeCheck` or `check: GoCheck`,
   with `ecosystem: '<eco>'`.
3. Add fixtures under `tests/<eco>/fixtures/<check_id>/` — at least one
   `good-*` and one `bad-*`. The fixtures must be real directory trees; the
   test invokes the ecosystem-appropriate `discoverJsRoots` /
   `discoverGoRoots` against them and feeds the resulting root into `check.run`.
4. Add `tests/<eco>/<check_id>.test.ts` asserting the findings count, the
   `check_id`, and key message fragments. Test against *behavior* (returned
   findings), not *implementation* (specific source strings).
5. Register the check in `src/registry.ts`'s `STATIC_CHECKS` or
   `AUDIT_CHECKS` array.
6. Write `docs/checks/<eco>/<check_id>.md` — this is what the finding's
   `doc_link` points at. Should explain: what failed, why we check it, and
   the precise fix.

### Design decisions

The load-bearing forks are documented in [docs/adr/](./docs/adr/). Read these
before making changes that look like they could reshape the workflow's
contract with the org.

## Rollout

The workflow is **not** referenced by the org ruleset yet. The rollout plan:

1. Land milestones 1–3 (all critical checks + suppression).
2. Run a one-off pre-flight: clone the top-N org repos and run the CLI
   against each from a developer laptop. Tally findings.
3. Communicate the findings to affected teams with a deadline.
4. After deadline, add `supply-chain.yaml@main` to the org ruleset.

There is no scheduled "drift detection" variant in v1. See
[ADR-0006](./docs/adr/0006-fixtures-only-no-periodic-v1.md).
