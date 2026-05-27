# Node-native TypeScript, no compilation, no runtime dependencies

The CLI is written in TypeScript and run directly via Node's native type-stripping (`node src/cli.ts` on Node 24+, no separate `tsc` build, no `tsx` wrapper). The runtime has **zero** dependencies; TypeScript is a `devDependency` only (used for editor tooling, not at runtime). The CLI accepts the "erasable syntax" constraint (no enums, no namespaces, no parameter properties) as the price of native execution.

## Considered

- **`tsx`.** Rejected: it's a runtime dependency, and a supply-chain tool that has its own supply-chain hygiene to maintain (hash-pin, audit, etc.) is the wrong shape to import. Native handles 99% of the same surface.
- **Compiled output (commit `dist/`).** Rejected: source and build artefacts drift, and the workflow becomes "did someone forget to run `npm run build`?". Native execution moves the problem out of the repo.
- **Bash + jq + yq.** Rejected upstream — the finding data model, sticky comment rendering, suppression parsing, and workspace classification are real software, not stringly-typed shell.

## Consequences

- The CLI cannot use enums, namespaces, or parameter properties. `tsconfig.json` sets `erasableSyntaxOnly: true` (and `verbatimModuleSyntax: true`) so the editor flags violations at write-time.
- The workflow file pins `actions/setup-node@<sha>` to a Node 24.x release where native TS is stable.
- Adding a runtime dependency in the future is not just a `npm install` — it's an ADR-worthy event, because it punctures the zero-dep posture this ADR establishes.
