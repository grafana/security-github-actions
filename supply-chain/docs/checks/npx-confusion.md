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

`npx` is a different beast from `npm install`. Where `install` works
from a manifest you can audit, `npx <name>` makes a **runtime decision**
about what to fetch — and the decision is one of the easier ones to
hijack.

### How npx resolves a binary name

When you run `npx foo`, npx looks for `foo` in this order:

1. A local `node_modules/.bin/foo` (your own dependency tree)
2. A global install
3. The npx cache from previous invocations
4. **The public registry — fetched fresh**

If none of 1–3 match, step 4 fires. npx fetches whatever package the
public registry returns when you ask it for `foo`, and **executes its
binary** with the args you gave on the command line. No tests, no
review, just run.

### The scoped-vs-unscoped trap

The risk is sharpest with **scoped packages**:

- Your internal package is `@grafana/foo`.
- It exposes a binary named `foo` (not `@grafana/foo`).
- Someone — maybe new to the team — writes `npx foo build` in a
  workflow because that's what `foo --help` says to type.
- If `foo` happens not to be installed locally, npx fetches a package
  literally named `foo` from the public registry, which an attacker has
  pre-registered.
- The attacker's `foo` package runs. The build step succeeds (or seems
  to). Code has executed with CI credentials.

This is **npx confusion** — the gap between "binary name you wrote" and
"package name npm resolves." Scoped packages are where the gap is widest
because the binary name is intentionally shorter than the package name.

### The unscoped variant: registry-resolution risk

Even when the binary name and the package name match (`generate-changelog`,
`http-server`, etc.), `npx <name>` still goes through the registry every
time the local cache misses. That's a continuous-publication trust
relationship with a package you may not have audited — every CI run is
an implicit "yes I want whatever the latest is."

This isn't strictly *confusion* — the right package gets fetched. But
the risk model is similar: the registry sees a request and serves
whatever's published, including a freshly-poisoned patch.

### Allowlist policy

A small list of well-established dev tools (`tsc`, `prettier`, `eslint`,
`vitest`, `tsx`, `next`, `vite`, `tsup`, …) is on the allowlist. These
are mature, widely-mirrored packages with long publish histories — the
typo-squat risk for the bare names has effectively been resolved by the
ecosystem.

For anything not on that list — scoped or unscoped — the safe pattern
is `npx --package <package> <binary>`. That tells npx exactly which
package to fetch; the binary-name lookup never runs. Or even better,
add the tool as a `devDependency` and invoke it from a `scripts:` entry,
which avoids npx entirely.

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
