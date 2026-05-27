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

Publishing jobs should not consume cache that other (lower-trust) CI jobs
have written to. A cache-poisoning attack lets a malicious PR write a
modified dependency tarball to the shared cache; if the publish job then
reads from that cache, the poisoned tarball goes out to the registry under
your name.

A clean install from the lockfile is fast enough that the cache savings
don't justify the risk for publishing workflows.

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
