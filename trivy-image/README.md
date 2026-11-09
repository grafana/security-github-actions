# Trivy image scan

Composite action that scans a container image built earlier in the same job with
[Trivy](https://github.com/aquasecurity/trivy) and posts an informational comment
on the pull request. It never fails the job because of findings.

What the comment shows:

- Counts by severity and how many findings have a fix.
- Vulnerabilities **introduced** and **resolved** compared to a baseline, when one is
  available (see [Baseline](#baseline)).
- The full list of findings at the requested severities, collapsed.

The same Markdown is written to the job summary, so fork PRs (which cannot post
comments) still get the results.

For why Trivy rather than Grype or OSV-Scanner, see [scanner-evaluation.md](scanner-evaluation.md).

## Requirements

Linux runner (x86_64 or arm64) with `docker`, `curl`, `jq` and `sha256sum`, which the
GitHub-hosted Ubuntu runners provide. The action checks for them up front.

## Usage

The image must exist in the runner's Docker daemon. With `docker/build-push-action`
that means `load: true` (single platform).

```yaml
permissions:
  contents: read
  pull-requests: write   # PR comment
  actions: read          # baseline artifact lookup (optional, see Baseline)

steps:
  - uses: docker/build-push-action@<sha>
    with:
      context: .
      load: true
      push: false
      tags: my-app:pr-${{ github.sha }}

  - uses: grafana/security-github-actions/trivy-image@<sha>
    with:
      image-ref: my-app:pr-${{ github.sha }}
      image-name: my-app
```

`image-name` is the stable identity used for cache keys, the baseline, the artifact
name and the comment id. Keep it identical between the PR and push workflows for the
same image.

### Baseline

The introduced/resolved section needs an SBOM of the image as it was before the
change. The action looks for one in this order and uses the first that works:

1. **`baseline-image-ref`** – an image you name explicitly, e.g. the tag your default
   branch last pushed to a registry. It is pulled if not present locally (log in to the
   registry first) and its SBOM is cached by layer digest like the main image.
2. **Cached baseline** – the SBOM saved to the Actions cache by a previous run on the
   base branch (`baseline-ref`, default: the PR base branch).
3. **Baseline artifact** – the `trivy-image-baseline-<image-name>` workflow artifact
   from the most recent run on the base branch. Survives cache eviction (90-day
   retention) but needs `actions: read` on the token; without it this step is skipped
   with a notice.

Options 2 and 3 are populated by running the action on pushes to the base branch. On
`push` events (`save-baseline: auto`) the image's SBOM is saved both to the cache (under
the branch name) and as an artifact. If the merge workflow pushes to a registry instead
of loading locally, pull or load the image first, then point `image-ref` at it:

```yaml
# push-to-main workflow
- uses: grafana/security-github-actions/trivy-image@<sha>
  with:
    image-ref: us-docker.pkg.dev/.../my-app:${{ steps.meta.outputs.tag }}
    image-name: my-app
    comment: "false"
```

Alternatively, if the merge workflow always pushes a `latest` (or `main`) tag, skip the
push-side run entirely and diff against the registry image directly:

```yaml
- uses: grafana/security-github-actions/trivy-image@<sha>
  with:
    image-ref: my-app:pr-${{ github.sha }}
    image-name: my-app
    baseline-image-ref: us-docker.pkg.dev/<project>/<repo>/my-app:latest
```

Until a baseline exists, PR comments say so and show the full list only. The comment
heading indicates which source was used (`image`, `cached baseline` or `baseline
artifact`), and the `baseline-source` output exposes the same.

## How caching works

- The image's **SBOM** (CycloneDX) is cached, keyed on the image's layer digests and
  the Trivy version. Layer digests are content-addressed, so an unchanged image hits the
  cache even though its image ID changes with every build timestamp. On a hit, the
  expensive image analysis is skipped. A cached SBOM that fails validation is discarded
  and regenerated. Set `cache-sbom: "false"` for workflows that scan a stream of
  distinct images where the cache would never hit.
- Vulnerability matching always runs against the **current** Trivy DB, so a PR that
  has been open for a week still shows newly published CVEs. The DB is cached in
  six-hour buckets to match its publishing cadence, with a prefix fallback so a stale
  cache is updated incrementally rather than downloaded from scratch.
- The baseline SBOM is re-matched at the same moment with the same DB, so the
  introduced/resolved diff reflects only what the change did to the image, not DB drift
  between two scan times.

## Inputs

| Input | Default | Description |
|---|---|---|
| `image-ref` | required | Image reference in the local Docker daemon. |
| `image-name` | derived from `image-ref` | Stable name for cache/baseline/artifact/comment keys. |
| `severity` | `CRITICAL,HIGH` | Severities to report. |
| `ignore-unfixed` | `false` | Only report findings with a fixed version. |
| `trivyignores` | `` | Comma-separated workspace-relative `.trivyignore` paths. |
| `timeout` | `10m` | Timeout applied to each Trivy invocation. |
| `baseline-image-ref` | `` | Image to diff against; takes precedence over cache/artifact baselines. |
| `save-baseline` | `auto` | `auto` saves on `push` events; `true`/`false` override. |
| `baseline-ref` | PR base branch | Branch whose cached/artifact baseline to diff against. |
| `cache-sbom` | `true` | Cache the image SBOM by layer digest. |
| `comment` | `true` | Post/update the PR comment. |
| `max-rows` | `100` | Max rows per findings table in the comment. |
| `github-token` | `${{ github.token }}` | Needs `pull-requests: write` for the comment and `actions: read` for the artifact fallback. |

## Outputs

`critical`, `high`, `medium`, `low`, `total`, `fixable`, `introduced`, `resolved`
(empty without a baseline), `baseline-found`, `baseline-source`
(`image|cache|artifact|none`), `sbom-cache-hit`, `report-path`, `sbom-path`.

Use them if a consumer wants its own gate, for example:

```yaml
- if: steps.scan.outputs.introduced != '' && steps.scan.outputs.introduced != '0'
  run: echo "::warning::This change introduces ${{ steps.scan.outputs.introduced }} new vulnerabilities"
```

## Failure behaviour

Findings never fail the job. Nor does a missing or broken baseline, an unreadable
cached SBOM, or a failed PR comment (a warning is emitted and the report is still in
the job summary). The action does fail when it cannot do its core job: the image is not
in the local daemon, Trivy cannot be installed or its checksum does not match, the
vulnerability DB cannot be downloaded after three attempts, or the scan itself errors.

## Supply chain

Trivy is installed as a pinned release binary (`TRIVY_BIN_VERSION` in `action.yml`,
updated by Renovate) with SHA-256 verification against the release checksums file. The
`aquasecurity/trivy-action` and `setup-trivy` actions are not used; they were the vector
of the March 2026 tag-hijacking incident
([GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)).
Third-party actions used here are pinned to commit SHAs. Package names, versions and
URLs in the comment come from the image and the vulnerability DB and are escaped before
rendering; only plain `https://` advisory URLs are linked.

## Suppressing findings

A `.trivyignore` at the consumer repo root is picked up automatically; use
`trivyignores` to point at other files instead. Entries are CVE IDs, one per line,
optionally with an `exp:YYYY-MM-DD` expiry; see the
[Trivy docs](https://trivy.dev/latest/docs/configuration/filtering/#trivyignore).
