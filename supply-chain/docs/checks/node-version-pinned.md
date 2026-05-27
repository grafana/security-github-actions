# `node-version-pinned`

**Severity:** advisory

## What this check verifies

For every root, at least one of these signals must declare a Node.js version
of **24.5.0 or newer**:

1. `engines.node` in `package.json`
2. `.nvmrc` at the root
3. `.node-version` at the root
4. `volta.node` in `package.json`

The first signal found is the one evaluated. Ranges (`>=24.5.0`, `^24.5.0`)
are parsed for their *minimum* satisfying version — that's what must clear
the bar.

## Why this is advisory

Bumping Node major versions is genuinely non-trivial work (deps, breaking
changes), and failing this check does not directly compromise the
supply-chain mitigations — an old Node still respects `ignore-scripts`,
`allow-git`, and the rest. See [ADR-0003](../adr/0003-v1-check-scope.md)
for the demotion rationale.

## How to fix

Pick whichever signal your team already uses (don't add a new one for the
sake of this check):

- `engines.node`:
  ```json
  { "engines": { "node": ">=24.5.0" } }
  ```
- `.nvmrc`:
  ```
  24.5.0
  ```

## Suppressing

```yaml
suppressions:
  - check_id: node-version-pinned
    reason: "Migration to Node 24 tracked in <ticket>"
    expires: 2026-09-30
```
