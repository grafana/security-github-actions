#!/usr/bin/env bash
# vim: ai:ts=8:sw=8:noet
set -euo pipefail

# renovate: datasource=docker depName=trufflesecurity/trufflehog
TRUFFLEHOG_DEFAULT_VERSION="3.99.8@sha256:674b2f187620a19df77f44cf9a7d77efcc581a5662accef2f2739cbb46ba4a3a"
TRUFFLEHOG_VERSION="${TRUFFLEHOG_VERSION:-${TRUFFLEHOG_DEFAULT_VERSION}}"

docker \
    run \
    --volume "$(pwd):/workdir" \
    --interactive \
    --rm \
    "trufflesecurity/trufflehog:$TRUFFLEHOG_VERSION" \
    git \
    file:///workdir \
    --since-commit HEAD \
    --results=verified,unknown \
    --fail