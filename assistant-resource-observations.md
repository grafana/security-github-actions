# Assistant resource-change observations

The organization-required Assistant workflow still requires two distinct human
approvals of the current commit, from people with write/admin access. This change
adds **reporting only** for `grafana/deployment_tools`. There is deliberately no
switch or output that lowers the approval threshold.

After the existing gate runs, the workflow looks for the newest exporter run for
the PR head. The run must have completed successfully for the current source
base and head, originate in the same repository, and use
`.github/workflows/kube-manifests-exporter.yaml`. It downloads exactly one
`assistant-resource-change-report-<run-attempt>` artifact, validates its versioned
JSON contract, then rechecks the PR and run attempt before writing the summary.
No PR code is checked out or executed. The artifact is treated as data.

The producer is the `assistant-resource-report` command in
`deployment_tools/scripts/tanka/kube-manifests-exporter`. It compares the complete
rendered manifest trees, recognizing only increases to existing replicas and
regular-container CPU/memory values on supported workloads. It records source
head/base, checkout SHA, manifest SHAs, run ID, and attempt. It uses schema version
1 and policy `assistant-resource-increases-v1`.

Source scope is checked separately: only modified `.jsonnet`/`.libsonnet` files
under `ksonnet/environments/` and `ksonnet/lib/`, excluding `ksonnet/lib/meta/`, can
be candidates. New/deleted/renamed files, mixed Terraform changes, workflow or
classifier changes, and incomplete file lists do not qualify. These restrictions
do not prove that Jsonnet has no latent effects beyond the current render.

Missing/expired reports, stale source bases or heads, failed/incomplete exporters,
older attempts, ambiguous artifacts, API failures, and malformed reports leave
the gate unchanged. Observation steps cannot turn a failed approval check into
a passing one. Other repositories do not download reports.

## Rollout

1. Merge the deployment_tools producer, then this consumer (the consumer is also
   safe to merge first; it simply finds no report).
2. After export finishes, rerun the Assistant check from the PR's Checks tab.
   It reports either a candidate or a non-candidate and continues to require two
   approvals. Its existing event triggers have not changed. A changed source
   base requires a fresh matching export, typically after updating the PR branch.
3. Inspect examples of memory/CPU increases, replica increases, mixed changes,
   and alert removals. deployment_tools#827785 is an alert-removal negative case.
4. Before changing enforcement, Security/Platform must review the observed false
   positives/negatives, source/render coverage, and producer provenance. Pin the
   classifier/producer to reviewed code independent of the PR and establish
   authoritative render completeness; the report's boolean is not sufficient
   authorization on its own. Decide how exporter completion/review events rerun
   the gate before automating the user flow.

The report is retained for seven days. Use a fresh export if it has expired.
Merge-queue checks use the PR's report and the same revision checks; this rollout
does not certify the combined contents of a multi-PR merge group.

## Tests

`node --test tests/assistant-approvals.test.cjs` executes the inline scripts from
the actual workflow with mocked GitHub APIs and temporary report files. It covers
selection, stale/malformed results, run attempts, source scope, merge-queue
lookup, and preservation of the two-approval gate. CI runs it on relevant changes.
