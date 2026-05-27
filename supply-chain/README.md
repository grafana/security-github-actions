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

If the workflow says you have a **blocking** finding, you must fix it (or
file a [suppression](#suppressions)) before merge. **Advisory** findings
appear in the same comment but do not block merging.

## What gets checked

### Blocking (fail merge if violated)

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
| `node-version-pinned` | A Node.js version ≥ 24.5.0 is pinned via `engines.node`, `.nvmrc`, `.node-version`, or `volta.node`. |
| `install-not-ci` | Workflows / Dockerfiles / Tiltfile / Makefile / mise.toml / shell scripts use the lockfile-strict install command (`npm ci`, `--frozen-lockfile`, `--immutable`). |
| `npx-confusion` | `npx <name>` invocations use either an allowlisted bare name, a scoped name, or `--package`. |
| `oidc-publishing` | Workflows that call `npm/pnpm/yarn publish` use OIDC trusted publishing (`id-token: write`, no long-lived tokens). |
| `cache-poisoning-publish` | Publishing workflows disable `actions/setup-node`'s package-manager cache. |
| `registry-audit` | Surfaces high/critical advisories from `npm/pnpm/yarn audit`. |

See [docs/checks/](./docs/checks/) for the per-check fix guide. Each finding
in the PR comment links to its check's doc page directly.

## How activation works

The workflow applies the **activation gate** before running anything:

- If your repo has **no `package.json` anywhere**, the workflow exits clean.
  This is what allows the same org-required workflow to apply to Go, Python,
  and other non-Node repos without false failures.
- If a `package.json` is found, the workflow walks the tree, classifies each
  manifest as a **root** or a **workspace member**, and runs the checks
  against the roots only.

In monorepos (npm/yarn `"workspaces"` or `pnpm-workspace.yaml`), only the
workspace root receives root-level checks. Workspace members do not.

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
| All blocking checks | ✅ shipped |
| Heuristic advisory checks (`install-not-ci`, `npx-confusion`, `oidc-publishing`, `cache-poisoning-publish`, `node-version-pinned`) | ✅ shipped |
| Workflow file at `.github/workflows/supply-chain.yaml` | ✅ shipped |
| Sticky PR comment | ✅ shipped |
| Suppression mechanism (`.github/supply-chain.yml`) | ✅ shipped |
| `registry-audit` advisory (run `npm/pnpm/yarn audit` in a dedicated job, merged into the unified comment) | ✅ shipped |

## For developers of this tool

Local development:

```bash
cd supply-chain
node --version            # must be >= 24.5.0
npm install               # only fetches devDependencies (typescript, @types/node)
npm test                  # node --test against tests/**/*.test.ts
node --experimental-strip-types src/cli.ts /path/to/some/repo
```

### Layout

```
supply-chain/
  CONTEXT.md              # domain glossary
  README.md               # this file
  package.json
  tsconfig.json
  src/
    types.ts              # Finding, Check, Root, RepoContext
    walk.ts               # workspace-aware root discovery
    report.ts             # markdown rendering for sticky comment + step summary
    cli.ts                # entry point
    checks/
      lockfile-committed.ts
  tests/
    fixtures/<check>/<good|bad-*>/...
    *.test.ts             # node --test
  docs/
    adr/                  # architecture decision records
    checks/               # per-check fix guide (each linked from the finding)
```

### Workflow architecture (3 jobs, 3 CLIs)

The workflow runs three jobs that fan-in to a single sticky comment:

```
              ┌──────────┐         static-findings.json (artifact)
              │  static  │────────────────────────────────────────┐
              └──────────┘                                          │
detect ──┬─►   src/cli.ts                                           ▼
         │                                                     ┌─────────┐
         │   ┌──────────┐         audit-findings.json          │ report  │
         └─► │  audit   │─────────────────────────────────────►│         │
             └──────────┘                                       └─────────┘
             src/audit-cli.ts                                   src/render-cli.ts
                                                                + src/post-comment.ts
```

- **`static`** runs `src/cli.ts` which invokes every non-network check across all roots. Its **non-zero exit on blocking findings is what fails the workflow** and gates merge. Writes `static-findings.json`.
- **`audit`** runs `src/audit-cli.ts` which invokes only `registry-audit`. **Always non-blocking** (`continue-on-error: true` on the job — ADR-0001). Writes `audit-findings.json`.
- **`report`** depends on `[static, audit]` with `if: always()`. Downloads both artifacts, runs `src/render-cli.ts` to merge the payloads and produce one markdown body, then `src/post-comment.ts` posts/updates the sticky PR comment.

Each CLI also writes its own GitHub Step Summary so that the *job's* page shows its own findings — but the **single comment on the PR is the source of truth**.

### Adding a new check

1. Decide the `check_id` — it is **append-only** once shipped. Suppressions
   reference it by string forever. See [ADR-0005](./docs/adr/0005-suppression-as-in-repo-config.md).
2. Add `src/checks/<check_id>.ts` exporting `check: Check`.
3. Add fixtures under `tests/fixtures/<check_id>/` — at least one `good-*` and
   one `bad-*`. The fixtures must be real directory trees; the test invokes
   `discoverRoots` against them and feeds the resulting `Root` into `check.run`.
4. Add `tests/<check_id>.test.ts` asserting the findings count + check_id + key
   message fragments. Test against *behavior* (returned findings) not
   *implementation* (strings in source).
5. Register the check in `src/cli.ts`'s `CHECKS` array.
6. Write `docs/checks/<check_id>.md` — this is what the finding's `doc_link`
   points at. Should explain: what failed, why we check it, and the precise
   fix.

### Design decisions

The load-bearing forks are documented in [docs/adr/](./docs/adr/). Read these
before making changes that look like they could reshape the workflow's
contract with the org.

## Rollout

The workflow is **not** referenced by the org ruleset yet. The rollout plan:

1. Land milestones 1–3 (all blocking checks + suppression).
2. Run a one-off pre-flight: clone the top-N org repos and run the CLI
   against each from a developer laptop. Tally findings.
3. Communicate the findings to affected teams with a deadline.
4. After deadline, add `supply-chain.yaml@main` to the org ruleset.

There is no scheduled "drift detection" variant in v1. See
[ADR-0006](./docs/adr/0006-fixtures-only-no-periodic-v1.md).
