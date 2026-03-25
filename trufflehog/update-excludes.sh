#!/usr/bin/env bash
# Optional: regenerates trufflehog/global-exclude.txt (readable snapshot; CI builds from prefixes.txt at runtime).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "${ROOT}/trufflehog/build_exclude_file.py" > "${ROOT}/trufflehog/global-exclude.txt"
echo "Wrote ${ROOT}/trufflehog/global-exclude.txt"
