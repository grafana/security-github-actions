# `npmrc-correct`

**Severity:** critical · **Applies to:** npm roots

## What this check verifies

For every npm root, the root-level `.npmrc` file must contain all three
required keys at the expected values:

```
ignore-scripts=true
allow-git=none
min-release-age=3
```

One **finding is emitted per missing or wrong-valued key**, so a fresh
repo with no `.npmrc` will get three findings telling you exactly what to add.

`min-release-age` is treated as a **minimum**: any value ≥ 3 passes. A
team that wants a longer cooldown (e.g. `min-release-age=7`) is more
strict, not less, and is not flagged. The other two keys are
boolean/enum where the literal value is the only correct setting.

## Why we check this

Each of the three keys closes a *different* attack vector. None of them
are theoretical — each maps to a known, repeatedly-exploited class of
supply-chain compromise.

### `ignore-scripts=true` — disable post-install hooks

This is the **single highest-impact knob** in the entire workflow.

When you run `npm install`, every package in your dependency tree can
declare `scripts.postinstall` (and `preinstall`, `install`, `prepare`).
npm executes these *automatically*, on your machine, with your
credentials, before any test has run or any code has been imported.

The historical incidents — `event-stream`, `ua-parser-js`, `node-ipc`,
`@solana/web3.js`, the `nx` post-install crypto miner — all run their
payload through this mechanism. A maintainer's publish token leaks → a
malicious patch ships → every CI and dev machine that runs `npm install`
executes the attacker's code, *just from installing*. No `import` needed.

`ignore-scripts=true` turns this off globally. Legitimate packages that
need a build step (e.g. native modules like `node-sass`) keep working
by being run explicitly via package scripts later; what stops is
arbitrary-package-on-the-internet auto-execution.

For npm, this is the **only** mitigation that defeats the dominant
attack vector. There is no patching-around it on the package side; the
control belongs on the consumer.

### `allow-git=none` — block git-source dependencies

A normal dependency is `"lodash": "^4.17.0"` — npm resolves that against
the registry, where the package has been (in theory) malware-scanned, has
download statistics, can be unpublished, and has provenance attestations
if it opted in.

A git dependency is `"lodash": "git+https://github.com/attacker/lodash.git#main"` —
npm clones the repo at install time and uses whatever's on that branch.
**None of the registry safety net applies**:
- No malware scan.
- No `min-release-age` cooldown — `#main` resolves *right now*.
- No provenance — `npm publish --provenance` doesn't apply.
- Mutable target — `#main` today is not `#main` tomorrow; the attacker
  force-pushes after your PR gets merged.

`allow-git=none` refuses to install any git-source dependency. If you
genuinely need a fork, vendor it or publish it to a private registry.

### `min-release-age=3` — install cooldown

Malicious versions are typically detected and unpublished within
hours-to-days of release. The attack pattern is:

- Attacker compromises a maintainer account on Monday morning.
- Malicious version is published Monday afternoon.
- Community notices weird behavior Tuesday.
- npm unpublishes Tuesday or Wednesday.

If your CI installs Monday afternoon → Wednesday morning, you're inside
the attack window. `min-release-age=3` says "don't install any version
that was published less than 3 days ago" — the cooldown catches the
typical detect-and-yank cycle while still letting genuine releases
through within a normal sprint.

3 days matches the org's default Renovate config, so dependency-update
PRs are unaffected by the gate.

### How these three interact

These checks **complement each other**, not duplicate. An attack that
gets past one is usually caught by another:

| Attack mechanism | `ignore-scripts` | `allow-git=none` | `min-release-age=3` |
|---|---|---|---|
| Malicious `postinstall` in a registry package | ✅ blocks | — | partial (only inside cooldown) |
| Mutable git-source dep updated after merge | — | ✅ blocks | — |
| Fresh malicious version published to registry | partial | — | ✅ blocks |

## How to fix

Create or edit `.npmrc` at the root that flagged:

```
ignore-scripts=true
allow-git=none
min-release-age=3
```

Comments (`#`) and blank lines are allowed. The order doesn't matter.

## Suppressing this check

```yaml
suppressions:
  - check_id: npmrc-correct
    reason: "Vendored upstream config conflicts; tracked in <ticket>"
    expires: 2026-12-31
```
