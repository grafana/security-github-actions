# The workflow and the `/check-npm` skill are independent implementations

The hardening guide references a `/check-npm` Claude/Cursor skill that performs the same checks on a developer machine. We deliberately do not share code between the skill and this workflow. Both will encode the rules independently, and drift is accepted as a human-discipline problem rather than a tooling problem.

## Consequences

- Drift will happen. The expected failure mode is "skill says pass, CI says fail." Whichever check is correct in that moment must be reconciled by hand.
- Implication for the CLI shape: we are *not* designing it to be reusable by the skill. It can be a tightly-fit tool with no plugin surface.
- If drift becomes a real pain point later, the migration is to extract a shared CLI and have both surfaces call it. This is path B in the original tradeoff; we chose to defer paying for it until forced.
