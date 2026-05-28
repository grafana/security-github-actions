# Add Go support as a parallel ecosystem

The workflow now spans two ecosystems: JS (Node.js) and Go. Checks live under `src/checks/js/` and `src/checks/go/`. Each `Check` is statically tagged with `ecosystem: 'js' | 'go'`; the engine pairs a check with a root only when the ecosystems match, so a JS check is never invoked against a Go root and vice versa. The `Root` type is a discriminated union (`NodeRoot | GoRoot`); the two walkers (`walk.ts`, `walk-go.ts`) produce their own variant and the engine runs them both before dispatching checks.

## Considered

- **A single ecosystem-aware `Root` with optional fields per ecosystem.** Rejected: the per-ecosystem field set differs too much (npm has lockfiles + package manager pin; Go has go.sum + toolchain). The union keeps each check's code path narrow and TypeScript-typed.
- **Two separate workflow files (`supply-chain.yaml` + `supply-chain-go.yaml`).** Rejected: doubles the ruleset surface for marginal isolation benefit. The current shape — one workflow, two parallel jobs each per-ecosystem-aware — preserves the single-comment-per-PR UX. The activation gate fires on `package.json` OR `go.mod`.
- **Use a generic "vulnerability scan" abstraction across ecosystems.** Rejected: `npm audit` and `govulncheck` have fundamentally different output shapes and semantics (govulncheck does reachability analysis; npm audit doesn't). Treating them uniformly would lose signal. Each has its own parser, finding shape, and doc page.

## Consequences

- **`check_id`s remain globally unique.** A Go check's id (`gosum-committed`) must never collide with a JS check's id, even though they target different ecosystems. The id is the suppression key and the metrics key — it must be unambiguous.
- **Workflow runners now install Go.** The `audit` job's `setup-go` step adds ~10–15 seconds; `govulncheck` install adds another ~5. Negligible compared to the typical npm/pnpm install time but worth noting in the rollout discussion.
- **The ecosystem split is the only kind of polymorphism the engine accepts.** New ecosystems (Python, Rust, etc.) would follow the same pattern: a new walker, a new root variant, a new `Check` arm in the union, a new `checks/<eco>/` directory. We don't bake in a plugin system or runtime registry; new ecosystems are first-class TypeScript additions.
- **Per-ecosystem activation does not exist.** Once the gate fires, *all* checks run. A repo with only `package.json` has Go checks return zero findings (no Go roots discovered) and vice versa. No noise; no opt-out.
