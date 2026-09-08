# Security GitHub Actions

This repository contains shared GitHub Actions security workflows.

## Workflows

- [SkillSpector static scan](skillspector/README.md) scans agent skills before merge. It uses static analysis and does not use an LLM.
- [Trivy diff](trivy/README.md) reports new dependency vulnerabilities in pull requests.

This repository is based on [grafana/grafana-github-actions](https://github.com/grafana/grafana-github-actions).
