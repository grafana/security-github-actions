### Trivy Diff

Use this as a reusable workflow like:

```
name: Trivy-diff

on:
  pull_request:
    types: [synchronize, opened, reopened]
    paths:
      # Python
      - '**/Pipfile.lock'
      - '**/poetry.lock'
      - '**/requirements.txt'
      # PHP
      - '**/composer.lock'
      # Node.js
      - '**/package-lock.json'
      - '**/yarn.lock'
      - '**/package.json'
      # Go
      - '**/go.sum'  
jobs:
  trivy-scan:
    runs-on: ubuntu-latest
    
    steps:
      # Use the Trivy Diff reusable workflow
      - uses: grafana/security-github-actions/trivy/@trivy-diff
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          severities: "CRITICAL,HIGH"
```

Then this workflow will only be ran on PRs and only if a manifest file has been modified. 
