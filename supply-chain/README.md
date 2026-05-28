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
- a **sticky PR comment** that updates on every push

If the workflow says you have a **critical** finding, you must fix it (or
file a [suppression](#suppressions)) before merge.

You can also run the exact same checks on a local clone — no CI needed:
`cd supply-chain && npm install && npm run check -- /path/to/repo`. See
[Running it locally](#running-it-locally-against-a-local-clone-no-ci-required).

## What gets checked

> **Scope note (PR1):** this PR ships a deliberately narrow subset of the
> org hardening guide — the four checks needed to enforce **post-install-
> script disabling** across npm, pnpm, and yarn. The remaining JS checks
> (`lockfile-committed`, `lockfile-conflict`, full versions of the
> `*-correct` keysets, the heuristic checks, `registry-audit`) and Go
> support ship in follow-up PRs. See
> [ADR-0003](./docs/adr/0003-v1-check-scope.md).

### Critical (fail merge if violated)

| ID | What it checks |
|---|---|
| `packagemanager-pinned` | `package.json` declares `packageManager:` at or above the minimum version. |
| `npmrc-correct` | npm roots have `.npmrc` with `ignore-scripts=true`. |
| `pnpm-workspace-correct` | pnpm roots have `pnpm-workspace.yaml` with `strictDepBuilds: true`. |
| `yarnrc-correct` | yarn roots have `.yarnrc.yml` with `enableScripts: false`. |

See [docs/checks/js/](./docs/checks/js/) for the per-check fix guide. Each
finding in the PR comment links to its check's doc page directly.

## How activation works

The workflow applies the **activation gate** before running anything:

- If your repo has **no `package.json`** anywhere, the workflow exits clean.
  Repos in other ecosystems (Python, Go, Rust, etc.) pass through silently.
- If `package.json` is found, the workflow walks the tree, classifies each
  manifest as a **root** or a **workspace member**, and runs the checks
  against the roots only.

In JS monorepos (npm/yarn `"workspaces"` or `pnpm-workspace.yaml`), only
the workspace root receives root-level checks. Workspace members do not.

## Suppressions

If you have a legitimate reason a specific check cannot pass on your repo,
commit `.github/supply-chain.yml` listing the check IDs you want to suppress:

```yaml
suppressions:
  - check_id: npmrc-correct
    reason: "Vendored upstream config conflicts; tracked in <ticket>."
    expires: 2026-12-31   # optional but encouraged — past this date the suppression is ignored
```

Suppressed findings still appear in the PR comment under the **Suppressed**
section. They are never silently dropped, and the suppression file itself is
audited in git history.

## Excluding paths from the walker

If your repo contains `package.json` files that are *not* real projects
(throwaway fixtures, vendored copies the workflow shouldn't inspect),
commit a `.supply-chain-check-ignore` file at the repository root, listing
one directory prefix per line:

```
# Throwaway fixture manifests used only by unit tests.
tests/fixtures
```

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

- **0** — no critical findings
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
      npm run check --silent -- "/tmp/sc-scan/${repo##*/}" ) | head -30
done
```

## For developers of this tool

```bash
cd supply-chain
node --version            # must be >= 24.5.0
npm install               # devDependencies only (typescript, @types/node)
npm test                  # fixture-driven unit tests
npm run check             # dogfood against the surrounding repo
```

### Layout

```
supply-chain/
  CONTEXT.md              # domain glossary
  README.md
  package.json
  tsconfig.json
  src/
    # reusable
    types.ts              # Finding, Check, Root, RepoContext
    engine.ts             # walk + run checks + apply suppressions
    report.ts             # markdown renderer
    text-report.ts        # terminal renderer
    check.ts              # single CLI entry point (used in CI + locally)
    registry.ts           # single source of truth for which checks exist
    io.ts, render-cli.ts, post-comment.ts, suppressions.ts, progress.ts
    # JS-specific (a follow-up PR adds src/go/ alongside)
    js/
      walk.ts             # discoverJsRoots()
      _config-helpers.ts
      packagemanager-pinned.ts
      npmrc-correct.ts
      pnpm-workspace-correct.ts
      yarnrc-correct.ts
  tests/
    js/
      walk.test.ts, packagemanager-pinned.test.ts, …
      fixtures/<check>/<good|bad-*>/...
  docs/
    adr/                  # architecture decision records
    checks/
      js/<check_id>.md    # per-check fix guide
```

### Workflow architecture (3 jobs, 1 CLI)

PR1 ships two real jobs (`static` + `report`) gated by the `detect`
activation gate; a follow-up PR adds an `audit` job for the
network-dependent `registry-audit` check.

```
detect ──► static ──► report
              check.ts             render-cli.ts + post-comment.ts
              (critical → exit 1)
```

- **`detect`** — cheap activation gate; skips the rest if no `package.json`.
- **`static`** — runs all critical checks across all roots. Non-zero exit on critical findings is what fails the workflow and gates merge. Writes `static-findings.json`.
- **`report`** — `if: always()` on `static`. Downloads the artifact, renders the markdown body via `render-cli.ts`, posts/updates the sticky PR comment via `post-comment.ts`.

The same `check.ts` is what runs locally via `npm run check`. CI mode vs
local mode is determined by environment variables: if
`SUPPLY_CHAIN_FINDINGS_OUT` is set, it writes the JSON payload; otherwise it
prints the rendered report to stdout.

### Adding a new check

1. Decide the `check_id` — it is **append-only** once shipped. Suppressions reference it by string forever. See [ADR-0005](./docs/adr/0005-suppression-as-in-repo-config.md).
2. Add `src/js/<check_id>.ts` exporting `check: NodeCheck` with `ecosystem: 'js'`.
3. Add fixtures under `tests/js/fixtures/<check_id>/` — at least one `good-*` and one `bad-*`. The fixtures must be real directory trees; the test invokes `discoverJsRoots` against them and feeds the resulting root into `check.run`.
4. Add `tests/js/<check_id>.test.ts` asserting the findings count, the `check_id`, and key message fragments. Test against *behavior* (returned findings), not *implementation* (specific source strings).
5. Register the check in `src/registry.ts`'s `ALL_CHECKS` array.
6. Write `docs/checks/js/<check_id>.md` — this is what the finding's `doc_link` points at. Should explain: what failed, why we check it, and the precise fix.

### Design decisions

The load-bearing forks are documented in [docs/adr/](./docs/adr/). Read these
before making changes that look like they could reshape the workflow's
contract with the org.

## Rollout

The workflow is **not** referenced by the org ruleset yet. The rollout plan:

1. Land PR1 (post-install-script enforcement) + follow-up PRs (rest of JS, then Go).
2. Run a one-off pre-flight: clone the top-N org repos and run the CLI against each from a developer laptop. Tally findings.
3. Communicate the findings to affected teams with a deadline.
4. After deadline, add `supply-chain.yaml@main` to the org ruleset.

There is no scheduled "drift detection" variant in v1. See
[ADR-0006](./docs/adr/0006-fixtures-only-no-periodic-v1.md).
