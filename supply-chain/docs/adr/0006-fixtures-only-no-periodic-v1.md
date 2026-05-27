# V1 testing is fixture-driven only; no periodic dry-run workflow

V1 ships with unit tests against checked-in fixture directories (one good and several bad fixtures per check) and nothing else. There is no periodic workflow scanning the org for would-be findings, and no end-to-end test that spins up a real PR. The blast radius of "flip the ruleset to required" is not measured before rollout; it is discovered by watching merges in real time.

## Considered

- **Periodic dry-run workflow** mirroring `periodic-zizmor.yaml`, running daily against the org's repos and reporting findings as advisory before flipping the ruleset. Rejected by the user — explicit "I don't need the scheduled version" for now. The CLI is kept factorable so this can be added later (or run as a one-off shell script against `gh repo list` clones).
- **End-to-end workflow tests** (real GHA runs against fixture target repos). Rejected: slow, brittle, and the fixtures cover the value.

## Consequences

- Rollout to the org-required ruleset is a leap, not a glide. The README's rollout section should make this explicit: any rollout plan needs a pre-flight pass (manual `git clone` + run the CLI across a sample of repos) before the ruleset is flipped.
- If the rollout shock proves painful, the cure is to add the periodic workflow then, not to retrofit complex testing now.
