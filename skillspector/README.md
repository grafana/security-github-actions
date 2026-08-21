# SkillSpector static scan

This reusable workflow scans agent skills before merge. It uses [SkillSpector](https://github.com/NVIDIA/SkillSpector) static analysis. It does not use an LLM.

The default policy reports only new findings with `HIGH` or `CRITICAL` severity and confidence of at least `0.8`. This policy keeps existing findings and lower-confidence results out of pull request comments.

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
    uses: grafana/security-github-actions/.github/workflows/reusable-skillspector.yml@57baae77bd63874eb7c6b6deec4961c595136332
```

The examples pin the workflow to a full commit SHA. Update this SHA only after you review a newer workflow version.

Run the workflow on all pull requests. A change to a script, reference, or dependency file can change a skill's behavior.

Run the workflow once. Then, add its status check as a required check in the repository ruleset or branch protection rule. This setting prevents a merge before the scan passes.

The calling job must grant `pull-requests: write`. GitHub checks the permission for the comment job before it evaluates the job condition. Therefore, the caller must grant this permission when `comment-on-pr` is `false` too. The scan job does not receive this permission.

## Scan scope

The workflow finds `SKILL.md` files in hidden and nested skill directories. It scans each nested skill as a separate skill. It removes duplicate results that come from overlapping scans.

The scan checks the manifest, scripts, references, and dependency files in each skill directory. Skill discovery skips version control, virtual environment, dependency, and cache directories.

The workflow fails if SkillSpector cannot inspect required content. For example, it fails for these conditions:

- A symlinked directory in the scan root or a symlinked file in a skill.
- An unresolved Git LFS pointer in a skill.
- A Git submodule in the scan root.
- An unsupported partial file inspection or inspection exception.
- Any hidden file in a skill or an unexpected excluded directory.
- Other content that SkillSpector does not inspect.

The workflow permits the `.git` directory because Git creates it during checkout. It also permits a `__pycache__` directory that contains only `.pyc` or `.pyo` files. SkillSpector reports this bytecode with its high-confidence `SC8` rule. The workflow rejects all other scope exclusions.

SkillSpector does not fully inspect binary images. For pull requests, the workflow compares each partially inspected image with the base tree. It permits the image only if its path and SHA-256 digest match. This policy applies to PNG, JPEG, GIF, and WebP images. The workflow fails for a new, changed, or renamed image. It also fails for a partially inspected image when no base tree is available.

The reusable workflow rejects every Git submodule in the head and base repositories. This rule also applies to submodules outside skill directories. Remove each submodule before you use the reusable workflow.

## Finding policy

The default policy reports a finding only when all these conditions are true:

- The pull request introduces the finding.
- The severity is `HIGH` or `CRITICAL`.
- The confidence is at least `0.8`.

The workflow fails the scan when it reports a policy finding. It also fails when SkillSpector cannot complete a valid scan.

Static analysis cannot confirm that a finding is a vulnerability. Review each reported finding before you treat it as a vulnerability.

## Pull request comments

After a complete scan, the workflow adds one comment only when it reports policy findings. It updates the same comment after each later complete scan.

The workflow removes the comment after the findings are resolved. It does not add a success comment. A failed or incomplete scan does not change an existing comment.

Fork pull requests receive annotations and a job summary. The workflow does not comment on fork pull requests.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `runs-on` | `ubuntu-latest` | Select a Linux runner. |
| `min-confidence` | `0.8` | Set a value from `0.0` through `1.0` for HIGH and CRITICAL findings. |
| `fail-on-findings` | `true` | Fail the job for policy findings. Scanner errors always fail the job. |
| `comment-on-pr` | `true` | Update one comment on same-repository pull requests. |

Set `fail-on-findings` to `false` for advisory mode. Advisory mode uses warning annotations and does not fail the job for policy findings.

Example with a different confidence limit:

```yaml
jobs:
  skillspector:
    permissions:
      contents: read
      pull-requests: write
    uses: grafana/security-github-actions/.github/workflows/reusable-skillspector.yml@57baae77bd63874eb7c6b6deec4961c595136332
    with:
      min-confidence: 0.9
```

## Outputs

| Output | Purpose |
| --- | --- |
| `finding-count` | The number of findings that meet the policy. |
| `skill-count` | The number of skills in the pull request head. |

## Reports

After a complete scan, the workflow creates these results:

- Up to 50 annotations for policy findings.
- A job summary with up to 20 policy findings.
- A sanitized JSON artifact named `skillspector-static-report`.
- One pull request comment with up to 20 policy findings when the token can write comments.

The JSON artifact contains all policy findings. The comment and artifact omit SkillSpector's matched-evidence and code-snippet fields.

The job summary states when SkillSpector partially inspected unchanged images. A finding comment contains the same statement.

## No-LLM mode and network use

The workflow always passes `--no-llm`. It does not send skill file content to an LLM. It does not need a model API credential.

SkillSpector can send declared package names and versions to [OSV.dev](https://osv.dev). This lookup can occur in no-LLM mode.

The workflow scans local checkouts. It does not ask SkillSpector to clone or download a skill.

The workflow pins [SkillSpector `v2.9.6`](https://github.com/NVIDIA/SkillSpector/releases/tag/v2.9.6) to commit `29b0dc8c39424e8e31ca055fa027adf8ba8f9650`. This version reduces high-severity false positives in OAuth documentation.

## Existing findings and baselines

For pull requests, the workflow scans the base and head trees. It reports only findings that the head tree introduces.

The comparison includes the rule, severity, skill, file, and normalized finding evidence. It ignores a line-number change in the same file. It also ignores an unchanged file move after it verifies the complete file digest. For the `SC8` bytecode rule, a byte change at the same path is a new finding.

The workflow does not apply a baseline from the head tree. A pull request cannot hide a finding with its own baseline.
