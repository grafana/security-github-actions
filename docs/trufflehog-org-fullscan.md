# TruffleHog org scan (GitHub source)

Uses the official CLI: [trufflesecurity/trufflehog](https://github.com/trufflesecurity/trufflehog) — `trufflehog github --org=…` / `--repo=…`.

Workflow: `.github/workflows/org-trufflehog-fullscan.yml`

## Test on GitHub Actions

1. Add secret **`ORG_TRUFFLEHOG_PAT`** (read access to repos you scan).
2. **Actions** → **TruffleHog org scan (GitHub)** → **Run workflow**.
3. **Quick test:** set **single_repo** to e.g. `https://github.com/trufflesecurity/test_keys` (public canary) or any repo URL you may read.
4. Download artifact **`trufflehog_github_<run_id>`** → `results.json` / `results.ndjson`.

## Test locally (same behavior)

```bash
trufflehog github --repo=https://github.com/trufflesecurity/test_keys --json --no-update --results=verified,unverified
```

With token: add `--token="$GITHUB_TOKEN"`.

## Notes

- Workflow is advisory (no `--fail`); do not add as a required ruleset check if you want it off the merge path.
- Weekly schedule is optional; remove `schedule:` in the YAML for manual-only.
