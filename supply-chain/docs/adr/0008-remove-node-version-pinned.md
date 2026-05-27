# Remove `node-version-pinned` check

The `node-version-pinned` advisory check is removed entirely from the workflow (previously demoted to advisory in [ADR-0003](./0003-v1-check-scope.md), then dropped here).

## Considered

The check verified that a root pinned Node.js ≥ 24.5.0 via `engines.node`, `.nvmrc`, `.node-version`, or `volta.node`. The decision to remove was:

- **Direct supply-chain value: low.** Every supply-chain mitigation in this workflow (ignore-scripts, allow-git, min-release-age, OIDC publishing) works on old Node. Failing the check doesn't let a malicious package through.
- **Indirect value: real but diffuse.** EOL Node versions accumulate CVEs, and OIDC publishing requires a recent enough Node+npm combo to be adoptable. But that's "platform hygiene," not "supply-chain hardening."
- **Scope drift risk.** Every additional "kinda related" check we keep makes it harder to argue the workflow is *specifically* a supply-chain check. Better to keep the scope tight; teams that want a Node-version-pinning workflow can add one separately.

## Consequences

- The `check_id` `node-version-pinned` is retired. Per [ADR-0005](./0005-suppression-as-in-repo-config.md), `check_id`s are append-only — we don't rename or reuse — so any existing `.github/supply-chain.yml` suppression entry referencing this id will be silently ignored (no error: a suppression for a non-existent id matches no finding). That's the intended behaviour.
- Repos that adopted the check's recommendation and added `engines.node` or `.nvmrc` keep that practice; the workflow simply stops asking for it.
