# `npmrc-correct`

**Severity:** critical · **Applies to:** npm roots

## What this check verifies

For every npm root, the root-level `.npmrc` file must contain:

```
ignore-scripts=true
```

One finding is emitted if the file is missing, the key is missing, or
the value is anything other than `true`.

> **Scope note (PR1):** this check ships in a reduced form. `allow-git=none`
> and `min-release-age=3` from the org hardening guide are enforced in a
> follow-up PR — for now, `npmrc-correct` covers post-install-script
> disabling only.

## Why we check this

`ignore-scripts=true` is the **single highest-impact knob** in the entire
workflow.

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

## How to fix

Create or edit `.npmrc` at the root that flagged:

```
ignore-scripts=true
```

Comments (`#`, `;`) and blank lines are allowed.

## Suppressing this check

```yaml
suppressions:
  - check_id: npmrc-correct
    reason: "Vendored upstream config conflicts; tracked in <ticket>"
    expires: 2026-12-31
```
