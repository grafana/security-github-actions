# `gosum-committed`

**Severity:** critical · **Applies to:** Go modules

## What this check verifies

For every Go module (a `go.mod` not nested inside a workspace `use`
directive), `go.sum` must be:

1. Present on disk, **and**
2. Tracked by git.

Modules with no `require` entries in `go.mod` legitimately have no
`go.sum` (there's nothing to hash) — the check stays quiet for those.

## Why we check this

`go.sum` is **Go's integrity contract**. Each line is a SHA-256 hash of
a specific (`module`, `version`) tuple. When you run `go build`,
`go test`, or `go mod download`, the Go toolchain refuses to use any
fetched module whose hash doesn't match what `go.sum` says it should be.

Without `go.sum`:

- Every CI run fetches modules fresh, then **writes a brand-new
  go.sum on the fly**. There's no committed baseline to detect drift.
- A compromised dependency published moments before your CI run has no
  cross-check — whatever bytes the proxy serves are what you get.
- The `GOSUMDB` checksum database catches some of this, but `go.sum`
  is the *project-specific* attestation that *this exact build* was
  built against *these exact bytes*.

This is the closest Go analog to npm/pnpm/yarn's committed-lockfile
requirement (`lockfile-committed`), and the rationale is the same:
the integrity check is only as good as the file consuming it.

### Why "committed", not just "on disk"

A `go.sum` in `.gitignore` provides no protection. CI checks out the
repo fresh and starts from scratch; nothing on disk is referenced.

## How to fix

If `go.sum` is missing:

```bash
# from the module root that flagged
go mod tidy
git add go.sum
git commit
```

If `go.sum` exists on disk but the workflow reports it as not committed:
remove `go.sum` from `.gitignore` and any `.git/info/exclude`, then
`git add go.sum` and commit.

## Suppressing this check

Strongly discouraged. If your repo mirrors an upstream that ships
without `go.sum`, document the exception:

```yaml
suppressions:
  - check_id: gosum-committed
    reason: "Upstream mirror — see <ticket>"
    expires: 2026-12-31
```
