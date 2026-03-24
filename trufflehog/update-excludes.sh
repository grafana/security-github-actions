#!/usr/bin/env bash
# Regenerates trufflehog/global-exclude.txt from prefixes.txt + build_exclude_file.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "${ROOT}/trufflehog/build_exclude_file.py" > "${ROOT}/trufflehog/global-exclude.txt"
echo "Wrote ${ROOT}/trufflehog/global-exclude.txt"
