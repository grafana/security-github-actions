# `oidc-publishing`

**Severity:** advisory

## What this check verifies

For each GitHub workflow that contains a `npm publish` / `pnpm publish` /
`yarn npm publish` call, the workflow must:

1. Declare `permissions: id-token: write` (the OIDC posture)
2. Not reference long-lived tokens (`NPM_TOKEN`, `NODE_AUTH_TOKEN`,
   `NPM_AUTH_TOKEN`)

Either failure produces a single finding per workflow file.

## Why we check this

Long-lived npm publish tokens are a high-value target — leaked tokens
have caused real supply-chain compromises. Trusted publishing (OIDC) gives
each workflow run a short-lived, scoped credential, eliminating the
long-lived secret entirely. As a bonus, npm provenance is generated
automatically.

## How to fix

See [npm trusted publishers documentation](https://docs.npmjs.com/trusted-publishers).
The migration is two changes:

1. Configure the package on the npm registry side to trust your repo +
   workflow path.
2. Add `permissions: id-token: write` to the publishing job and remove the
   `NODE_AUTH_TOKEN` env var.

```yaml
jobs:
  publish:
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/setup-node@<sha>
        with:
          node-version: '24'
          registry-url: https://registry.npmjs.org/
      - run: npm publish
```

## Suppressing

```yaml
suppressions:
  - check_id: oidc-publishing
    reason: "<your reason>"
    expires: 2026-12-31
```
