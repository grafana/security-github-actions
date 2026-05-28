# `govulncheck-clean`

**Severity:** advisory · **Applies to:** Go modules

## What this check verifies

Runs [`govulncheck`](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)
against each Go module and emits **one finding per call-reachable
vulnerability** with the affected module, OSV identifier, vulnerable
function symbol, installed version, and patched version.

Findings are capped at 20 per module to keep the PR comment readable; a
summary "+ N more" finding tells you how many additional advisories
exist.

## Why we check this

This is the Go counterpart to npm's `registry-audit` — but it does
something `npm audit` cannot: **call-graph reachability analysis**.

Most vulnerability scanners report on the *module graph*: "your tree
contains module X at vulnerable version Y." That's noisy because most
of the time, the vulnerable function in module X isn't actually invoked
by your code — you imported the module for a different purpose entirely.

`govulncheck` resolves your *call graph* and only reports vulnerabilities
your code can actually reach. The trace it produces names the specific
function (`Parse`, `BadFn`, etc.) whose code path leads from your
binary into the vulnerable code. False-positive rate is dramatically
lower than naive graph scanning, and every finding is by definition
*actually exploitable* in your build.

### Example output

A finding looks like:

> **golang.org/x/text (GO-2023-1840): Stack exhaustion in cmd/go in syntax.Walk**
> Reaches `Parse` · Installed: `v0.12.0` · Fixed in: `v0.13.0`
> Fix: Update `golang.org/x/text` to `v0.13.0` or newer (`go get golang.org/x/text@v0.13.0`).
> [Docs](https://pkg.go.dev/vuln/GO-2023-1840) · `govulncheck-clean`

The doc link goes to **the OSV record's own URL** (`pkg.go.dev/vuln/...`)
when available — that page has the upstream mitigation guidance.

## Why this is advisory (not critical)

Vulnerability databases are mutable. A vuln published overnight can take
a previously-passing commit and make it fail with no code change. The
same reasoning as `registry-audit` (see
[ADR-0001](../adr/0001-single-workflow-two-jobs.md)) — dynamic checks
go in the advisory job; static checks gate merge.

## Why this runs in its own CI job

Govulncheck needs **network access** (to the Go vulnerability database
at `vuln.go.dev`) and a working Go toolchain. The audit job sets both
up; the static job stays offline.

## How to fix

The fix message is precise for each finding. Common cases:

- **Patched version exists**: `go get module@<fixed-version>` then
  `go mod tidy` and commit. The advisory's `fix` message includes the
  exact command.
- **No fix yet**: govulncheck names the symbol your code reaches. If you
  can avoid that symbol (use a different function in the same module, or
  guard the call), do that. Otherwise wait, suppress, or open an issue
  upstream.

## Suppressing

```yaml
suppressions:
  - check_id: govulncheck-clean
    reason: "<package> vuln tracked in <ticket>; mitigation in progress"
    expires: 2026-08-01
```
