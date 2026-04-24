#!/usr/bin/env bash
# vim: ai:ts=8:sw=8:noet
set -euo pipefail

# renovate: datasource=docker depName=trufflesecurity/trufflehog
TRUFFLEHOG_DEFAULT_VERSION="3.95.2@sha256:49d1c4fbbc580aac487ac7cb0517bb085826bd352d7578d62bb4c0c6b7205075"
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