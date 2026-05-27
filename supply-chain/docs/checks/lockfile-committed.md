# `lockfile-committed`

**Severity:** blocking

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

The lockfile is the single source of truth for which exact versions of
dependencies (transitive included) will be installed. Without a committed
lockfile:

- Two `npm install` runs minutes apart can produce different dependency
  graphs. CI, the developer's laptop, and the production builder may all
  install different code.
- A malicious package published moments before your CI's install step
  can be selected against a wide version range when no lockfile pins the
  resolution.
- Hardening controls like `min-release-age` and `allow-git=none` are
  applied at install time. If install resolutions aren't stable, the
  controls become harder to reason about.

A lockfile that exists on disk but is not committed (e.g. in `.gitignore`)
provides none of these guarantees: CI checks out the repo and starts from
scratch.

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
