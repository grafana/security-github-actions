# Socket license policy exclusion

Go tooling and GitHub Actions for managing Socket license policy exclusions across the Grafana GitHub org.

## Overview

Socket enforces license policies on Grafana repositories. Some repositories — hackathon projects, demos, prototypes, sandboxes — should be exempt. Exemption is controlled by applying an exclusion label to the repository in Socket.

This directory provides tooling to manage that label automatically. The source of truth for which repos should be excluded is a GitHub topic: any repo in the Grafana org tagged with the `socket-exclude-from-license-policy` topic will have the Socket exclusion label applied automatically.

## Workflow

**[Socket - Sync exclusion labels](../.github/workflows/socket-sync-exclusion-labels.yml)** runs daily at 06:00 UTC and can also be triggered manually.

- **Scheduled / manual (no repo name):** Fetches all repos in the Grafana GitHub org, filters to those with the `socket-exclude-from-license-policy` topic, fetches the repos that already have the Socket exclusion label applied, and applies the label to any repos in the diff.
- **Manual with a repo name:** Adds the Socket exclusion label to that specific repo immediately, without waiting for the next daily run.

### Excluding a repo from license policy enforcement

Add the `socket-exclude-from-license-policy` topic to the repository on GitHub. The next scheduled run will pick it up and apply the Socket label. For immediate effect, trigger the workflow manually with the repository name.

## Actions

### `cmd/socket/sync-exclusion-labels`

Composite action that runs the sync command. Used by the workflow for the daily sync.

| Input | Required | Default | Description |
|---|---|---|---|
| `socket_api_token` | yes | | Socket API authentication token |
| `socket_org` | no | `grafana` | Socket organization slug |
| `github_token` | yes | | GitHub token with org-level read access |
| `github_org` | no | `grafana` | GitHub organization to scan |
| `github_topic` | no | `socket-exclude-from-license-policy` | GitHub topic that marks repos for exclusion |

### `cmd/socket/add-exclusion-label-to-repo`

Composite action that applies the Socket exclusion label to a single named repository. Used by the workflow for on-demand single-repo additions.

| Input | Required | Default | Description |
|---|---|---|---|
| `socket_api_token` | yes | | Socket API authentication token |
| `socket_org` | no | `grafana` | Socket organization slug |
| `repository_name` | yes | | Name of the repository to label |

## Package structure

```
socket/
├── socket.go          # Socket API client (HTTP, auth, error handling)
├── repos.go           # GetRepo
├── labels.go          # GetLabelByName, GetLabeledRepoIDs, AssociateLabel
├── github.go          # GitHub API client, ListOrgReposWithTopic
└── cmd/socket/
    ├── add-exclusion-label-to-repo/   # One-shot command for a single repo
    └── sync-exclusion-labels/         # Bulk sync command
```

## Secrets

The workflow reads the following secrets from Vault:

| Vault path | Description |
|---|---|
| `socket:SOCKET_API_KEY` | Socket API key (`repo-label:list`, `repo-label:associate` scopes) |
| `github-app:app-id` | GitHub App ID |
| `github-app:app-installation-id` | GitHub App installation ID |
| `github-app:app-private-key` | GitHub App private key |

The GitHub App token is used to list all repositories in the Grafana org, which requires org-level read access beyond what the default `GITHUB_TOKEN` provides.
