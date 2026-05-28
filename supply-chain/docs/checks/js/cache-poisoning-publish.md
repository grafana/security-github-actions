# `cache-poisoning-publish`

**Severity:** advisory

## What this check verifies

For every GitHub workflow that contains a `npm/pnpm/yarn publish` call,
every `actions/setup-node@…` step must have the package-manager cache
disabled — either:

- `package-manager-cache: false` (the explicit input), or
- no `cache:` input at all

If a publishing workflow's setup-node step enables cache (e.g. `cache: 'npm'`),
one finding is emitted per step.

## Why we check this

Publishing workflows have **maximally privileged credentials** — they
sign things in your name, push to the registry, possibly mint provenance
attestations. Anything they consume during install needs to be at least
as trusted as the credentials they hold. The GitHub Actions cache is not.

### How cache poisoning works

The GitHub Actions cache is **shared across all workflow runs of a
repository**, regardless of branch or PR origin (with caveats around
fork PRs). The lifecycle is:

1. A workflow run writes a cache entry under some key (e.g. a hash of
   the lockfile). This includes the `node_modules/` tree or the
   package-manager store.
2. Future workflow runs that compute the same key read from the cache
   instead of installing from scratch — that's the speed-up.

The attack:

1. Attacker opens a PR against your repo. The PR's CI run has write
   access to the cache (this is the default; some setups restrict it,
   most don't).
2. The PR includes a benign-looking change that modifies the cache
   key — say it touches the lockfile — but also runs a step that
   **alters the on-disk `node_modules/` before the cache is uploaded**.
3. The poisoned cache is now keyed in a way the publishing workflow
   can hit on the next release.
4. The publishing workflow runs on `main`, restores the cache, and
   ships whatever the attacker put in `node_modules/` — signed with
   your provenance.

The poisoned bytes flow from "low-trust PR run" → "shared cache" →
"high-trust publish run." The publish doesn't see the malicious code as
code; it just sees what's in `node_modules/` after the cache restore.

### The fix is to never let the publish job read the cache

The `package-manager-cache: false` input on `actions/setup-node@v5+`
explicitly disables the package-manager cache for that setup-node step.
Omitting `cache:` entirely has the same effect — caching only happens
when you opt in via `cache: 'npm'` / `cache: 'pnpm'` / `cache: 'yarn'`.

A clean install from the committed lockfile in the publish job takes 30
seconds or so. The cache saving isn't worth the trust gap.

### Why this is advisory

The attack requires the attacker to land a PR in your repo (or a
malicious workflow on a long-lived branch) to seed the cache. That's not
trivial — but it's exactly the kind of multi-step exploit that high-
profile supply-chain attacks chain together. Surfacing as advisory lets
publish-bearing repos see the inventory and migrate gradually.

### Detection limitations

The check looks at every `actions/setup-node@…` step in a workflow file
that contains a publish call. It can't precisely tell which steps run in
the *publishing job* versus other jobs in the same file (that would
require full YAML walking). False positives in the form of
"non-publishing setup-node in a workflow that also has a publish job"
are possible; in practice, separating publishing into its own workflow
file is the simpler answer.

## How to fix

```diff
  - uses: actions/setup-node@<sha>
    with:
      node-version: '24'
      registry-url: https://registry.npmjs.org/
-     cache: 'npm'
+     package-manager-cache: false
```

## Suppressing

```yaml
suppressions:
  - check_id: cache-poisoning-publish
    reason: "<your reason>"
    expires: 2026-12-31
```
