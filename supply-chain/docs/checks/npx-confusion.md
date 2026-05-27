# `npx-confusion`

**Severity:** advisory

## What this check verifies

Scans the same fixed set of files for `npx <name>` invocations where
`<name>` is:

- Not preceded by `--package <pkg>`
- Not scoped (`@scope/name`)
- Not on a small allowlist of well-known dev tools (`tsc`, `prettier`,
  `eslint`, `vitest`, …)

## Why we check this

If `<name>` is not available locally or in the npx cache, npx fetches a
package by that exact name from the public registry. For scoped packages
whose binary name differs from the package name (e.g. `@grafana/foo`
exposing the binary `foo`), an attacker who registered the unscoped name
on the registry could intercept the call and execute code in CI.

## How to fix

Disambiguate by passing the package explicitly:

```diff
- npx foo arg1 arg2
+ npx --package @grafana/foo foo arg1 arg2
```

If the tool you're invoking is well-established and you'd like it added
to the allowlist, open a PR to
[`supply-chain/src/checks/npx-confusion.ts`](../../src/checks/npx-confusion.ts).
The allowlist is intentionally conservative — additions are a small
security review event.

## Suppressing

```yaml
suppressions:
  - check_id: npx-confusion
    reason: "<your reason>"
    expires: 2026-12-31
```
