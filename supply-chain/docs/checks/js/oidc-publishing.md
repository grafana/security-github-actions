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

Most of the checks in this workflow are about **consuming** packages
safely. This one is about **publishing** safely — and it's the lever
that determines whether *your* packages can be weaponised against
*everyone else* in the ecosystem.

### The attack this closes

The dominant supply-chain compromise in npm-world isn't malware in a
package; it's a **maintainer-token leak**. The pattern, over and over:

1. A maintainer's npm publish token leaks. Phishing, a stolen laptop, a
   `.env` accidentally committed, a CI log that wasn't redacted, a
   compromised dependency on a maintainer's *own* machine.
2. The attacker uses the still-valid token to publish a malicious patch
   under the maintainer's name. The package's registry page looks normal;
   provenance attestation, if it exists, looks normal too (the token
   was valid).
3. Everyone who installs the package within the next few hours runs
   the attacker's code.

Long-lived `NPM_TOKEN` secrets in GitHub Actions are sitting targets
for this. They live for months or years, scoped broadly (often "publish
anything this maintainer owns"), and a single workflow log leak or
compromised action exposes them.

### OIDC (trusted publishing) closes the gap

Trusted publishing replaces the long-lived token with a **short-lived,
workflow-scoped credential**:

1. You tell npm on the registry side: "the workflow at
   `grafana/foo/.github/workflows/publish.yml` is trusted to publish
   `@grafana/foo`."
2. The workflow declares `permissions: id-token: write` and runs
   `npm publish`.
3. GitHub mints a fresh OIDC token bound to this specific workflow run.
   npm verifies it (specific repo, specific workflow path, specific
   ref) and accepts the publish.
4. The token is valid for *that publish only*. There is no long-lived
   secret to leak.

If an attacker compromises a maintainer's npm account credentials, they
*cannot* publish via OIDC — the trust relationship is "this workflow on
this repo," not "this account."

As a bonus, **npm provenance is generated automatically** by the
trusted-publish path. Provenance is a cryptographic attestation that
ties a published package back to the specific commit + workflow run that
built it; downstream consumers can verify it. You get this for free
once OIDC is on.

### Why this is advisory

This check only fires on repos that *publish* npm packages — most repos
in the org don't. For the ones that do, migrating to OIDC is a
manageable change (registry-side config + a permissions block in the
workflow + dropping the `NPM_TOKEN` secret), and we surface it as
advisory to motivate that work without blocking unrelated PRs in the
meantime.

### Detection heuristic

We detect "this workflow publishes" by searching for `npm publish`,
`pnpm publish`, or `yarn npm publish` in workflow files. Workflows
that prepare a tarball without publishing (e.g. `npm pack` + manual
artifact upload) won't be flagged.

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
