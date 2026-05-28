# `lockfile-committed`

**Severity:** critical

## What this check verifies

For every root in your repository (a `package.json` not nested under a
workspace declaration), the lockfile that matches the declared package
manager must be **present in the working tree** and **tracked by git**.

| If `packageManager:` is | Required lockfile |
|---|---|
| `npm@…` | `package-lock.json` |
| `pnpm@…` | `pnpm-lock.yaml` |
| `yarn@…` | `yarn.lock` |

If `packageManager:` is missing entirely, this check stays quiet — the
separate `packagemanager-pinned` check handles the missing-pin case.

## Why we check this

The lockfile is the **foundation that every other hardening control sits on
top of**. Without it, none of the others have teeth.

### The attack

A typical npm-style supply-chain compromise unfolds in three steps:

1. Attacker compromises a package's publish token (phishing, credential leak)
   or, increasingly, takes over a maintainer account directly.
2. Attacker publishes a malicious patch — say `popular-lib@4.7.1` after the
   legitimate `4.7.0`.
3. Every CI run that installs `"popular-lib": "^4.7.0"` from a manifest
   *without* a lockfile resolves to `4.7.1` and runs the malicious code.

The community detection-and-yank cycle is typically hours: someone notices
weird behavior, npm unpublishes. But your CI ran in step 3.

A committed lockfile pins the resolved version + integrity hash. Even if a
poisoned version exists in the registry, `npm ci` / `pnpm install
--frozen-lockfile` / `yarn install --immutable` refuses to install it —
the lockfile says "I expect this exact bytes-on-disk for `popular-lib`."

### Why the lockfile must be **committed**, not just on disk

A lockfile in `.gitignore` is no lockfile at all. CI clones the repo and
starts from scratch — there's nothing to compare against. The "looks fine
locally, fails in CI" failure mode is exactly the developer-trust gap an
attacker exploits.

### How this interacts with the other checks

- `min-release-age=3` (npm) / `minimumReleaseAge: 4320` (pnpm) / 
  `npmMinimalAgeGate` (yarn) refuse to install package versions younger
  than 3 days. The lockfile is what those gates compare *against* —
  without a lockfile, every install resolves fresh and the age gate
  decides for itself, which is a wider attack surface.
- `lockfile-conflict` (next check) enforces "exactly one lockfile per
  root" so we always know which file is authoritative.

## How to fix

If the lockfile is missing on disk:

```bash
# from the root that flagged
npm install        # for npm
pnpm install      # for pnpm
yarn install      # for yarn
git add <the lockfile that appeared>
git commit
```

If the lockfile exists on disk but the workflow reports it as not committed:
remove the lockfile filename from your `.gitignore` and any `.git/info/exclude`,
then `git add` and commit it.

## Suppressing this check

We expect this finding to be fixable on nearly every repo. If your repo has
a genuine reason it cannot commit a lockfile (e.g. it mirrors an upstream
that ships without one), commit `.github/supply-chain.yml`:

```yaml
suppressions:
  - check_id: lockfile-committed
    reason: "Upstream mirror — lockfile owned by upstream repository <link>"
    expires: 2026-12-31
```

The finding will still appear under the **Suppressed** section of the PR
comment; it just won't block merge.
