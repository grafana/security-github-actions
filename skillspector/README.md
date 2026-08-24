# SkillSpector static scan

This reusable workflow scans agent skills before merge. It runs [SkillSpector](https://github.com/NVIDIA/SkillSpector) static analysis with `--no-llm`.

For pull requests, the default policy reports only new findings that meet both conditions:

- The severity is `HIGH` or `CRITICAL`.
- The confidence is at least `0.8`.

The workflow comments on these findings and fails the check by default. Static findings are not confirmed vulnerabilities. Review each finding before merge.

## Add the workflow

Create `.github/workflows/skillspector.yml` in the repository that contains the skills:

```yaml
name: Scan agent skills

on:
  pull_request:
  merge_group:
    types: [checks_requested]

permissions: {}

jobs:
  skillspector:
    permissions:
      contents: read
      pull-requests: write
    uses: grafana/security-github-actions/.github/workflows/reusable-skillspector.yml@8d0e6780f8cbb5e73ffec054615082ca2a26c536
```

Pin the workflow to a full commit SHA. Review a newer workflow version before you update the SHA.

Run the workflow once. Then, add its status check to the repository ruleset or branch protection rule. Keep `merge_group` if the repository uses a merge queue.

The caller must grant `contents: read` and `pull-requests: write`. A called workflow cannot increase the permissions that the caller grants.

The caller must grant both permissions when `comment-on-pr` is `false` too. GitHub checks job permissions before it evaluates step conditions.

## Finding policy

The workflow creates a temporary SkillSpector baseline when a skill has the same base-tree path. It passes this trusted baseline to the head scan.

A new or moved skill has no matching base path. The workflow reports its policy findings as new. It never applies a baseline from the pull request head.

A file change can make a previous finding report again. SkillSpector binds baseline entries to file content and finding evidence.

Other events have no base-tree comparison. For these events, the workflow reports all head findings that meet the policy.

Set `fail-on-findings` to `false` for advisory mode. This mode creates reports and comments, but policy findings do not fail the job. Scanner errors always fail the job.

## Pull request comments and reports

The workflow creates one comment when a same-repository pull request has policy findings. A later scan updates the same comment.

The workflow removes the comment when no policy findings remain. It does not create a success comment. A failed scan does not change an existing comment.

Fork pull requests do not receive comments. Their workflow runs still create a job summary and an artifact.

The comment and job summary list up to 20 findings. The JSON artifact contains all policy findings. Its name is `skillspector-static-report`.

The artifact contains rule IDs, severity, confidence, and locations. It omits matched findings, explanations, remediations, code snippets, and file content.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `runs-on` | `ubuntu-latest` | Select the Linux runner label. |
| `min-confidence` | `0.8` | Set the minimum confidence from `0.8` through `1.0`. |
| `fail-on-findings` | `true` | Fail the job when findings meet the policy. |
| `comment-on-pr` | `true` | Update one comment on same-repository pull requests. |

## Outputs

| Output | Purpose |
| --- | --- |
| `finding-count` | The number of findings that meet the policy. |
| `skill-count` | The number of skills in the head tree. |

## Scan scope

The workflow finds regular `SKILL.md` files in hidden and nested directories. It skips `.git`, `.venv`, `__pycache__`, and `node_modules` during discovery.

It runs the SkillSpector CLI once for each directory that contains a manifest. It removes duplicate findings from overlapping nested scans.

The checkout resolves Git LFS files before the scan. The workflow rejects all symbolic links and Git submodules in the repository.

The workflow fails if SkillSpector cannot fully inspect a skill. It rejects partial inspections, inspection exceptions, and excluded skill content.

For a repository-root skill, the workflow permits only the `.git` directory exclusion. Skills must not contain binary or hidden content that SkillSpector cannot inspect.

## No-LLM mode and network use

The workflow passes `--no-llm` to the baseline and scan commands. It checks the scan metadata to confirm that SkillSpector did not use an LLM.

The workflow does not send skill file content to an LLM. It does not need a model API credential.

SkillSpector can send declared package names and versions to [OSV.dev](https://osv.dev). This lookup can occur in no-LLM mode.

The workflow pins [SkillSpector `v2.9.6`](https://github.com/NVIDIA/SkillSpector/releases/tag/v2.9.6) to commit `29b0dc8c39424e8e31ca055fa027adf8ba8f9650`.
