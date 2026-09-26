#!/usr/bin/env bash
# vim: ai:ts=8:sw=8:noet
set -euo pipefail

# renovate: datasource=docker depName=trufflesecurity/trufflehog
TRUFFLEHOG_DEFAULT_VERSION="3.97.8@sha256:7fa530fec5e9e36b77b42117b319c677ab3e6eb50c979362748686a5d17185fe"
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