# `go-toolchain-pinned`

**Severity:** blocking · **Applies to:** Go modules

## What this check verifies

For every Go module, `go.mod` must:

1. Declare a `toolchain go1.X.Y` directive at a version ≥ **1.22.0**, and
2. The `go 1.X.Y` directive (if present) must also be ≥ 1.22.0.

The `toolchain` directive landed in Go 1.21; below that version it
doesn't exist and the check requires upgrading the module first.

## Why we check this

Two reasons, both about reducing implicit trust.

### The `toolchain` directive eliminates ambient-runner trust

Without `toolchain`, `go build` uses whatever Go is on the runner. That
means your build's behavior depends on whoever set up the GitHub Actions
image — including which patch level of Go is installed, when it was
installed, and whether it has known security fixes for the standard
library.

`toolchain go1.24.0` says "this module is built with **exactly** 1.24.0;
if a different version is installed, fetch and use 1.24.0." Go's toolchain
auto-download is cryptographically verified against the Go checksum
database, so the auto-fetch is itself trustworthy. The net effect: your
build no longer depends on runner image management for its security
posture.

### The version floor (1.22) catches genuinely old runtimes

Go EOLs versions ~12 months after a major release. Modules pinned to
Go 1.18 or earlier are running with stdlib code that hasn't received
security patches in years — `net/http`, `crypto/tls`, `archive/*`, etc.
The choice of 1.22 as the floor is conservative; in practice teams
should be on much newer.

We check the `go` directive (the module's *minimum* required Go version)
separately, because a module declaring `go 1.18` is signaling that
older Go versions are acceptable — and someone consuming this module
from another module with a similarly low floor will end up running on
that old version.

## How to fix

Add or update the `toolchain` directive at the top of `go.mod`:

```diff
  module example.com/foo

  go 1.22

+ toolchain go1.24.0
```

If the `go` directive is below 1.22, bump it too:

```diff
- go 1.18
+ go 1.22
  toolchain go1.24.0
```

Then run `go mod tidy` and commit the changes.

## Suppressing this check

```yaml
suppressions:
  - check_id: go-toolchain-pinned
    reason: "Migration to Go 1.22 tracked in <ticket>"
    expires: 2026-09-30
```
