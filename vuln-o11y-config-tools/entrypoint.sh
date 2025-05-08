#!/bin/sh
set -e

cmd="$1"; shift

case "$cmd" in
  validate)        /validate "$@";;
  publish-scans)   /publish-scans "$@";;
  dry-run)         /dry-run "$@" ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 64
esac
