# `yarnrc-correct`

**Severity:** critical · **Applies to:** yarn roots

## What this check verifies

For every yarn root, `.yarnrc.yml` must contain:

```yaml
enableScripts: false
```

One finding is emitted if the file is missing, the key is missing, or
the value is anything other than `false`.

> **Scope note (PR1):** this check ships in a reduced form.
> `enableImmutableInstalls: true`, `npmMinimalAgeGate: 4320`, and the
> forbidden `approvedGitRepositories` rule from the org hardening guide
> are enforced in a follow-up PR — for now, `yarnrc-correct` covers
> post-install-script disabling only.

## Why we check this

This is the yarn equivalent of npm's `ignore-scripts=true`. Same attack,
same mitigation: post-install hooks run untrusted code on `yarn install`
before any of your tests have a chance to scrutinize what's in the tree.
The historical incidents (`event-stream`, `ua-parser-js`, etc.) all
exploit this mechanism, and Yarn projects are equally vulnerable unless
this knob is flipped.

For yarn, this isn't on by default. You have to set it.

## How to fix

Create or edit `.yarnrc.yml`:

```yaml
enableScripts: false
```

## Suppressing this check

```yaml
suppressions:
  - check_id: yarnrc-correct
    reason: "<your reason>"
    expires: 2026-12-31
```
