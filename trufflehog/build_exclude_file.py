#!/usr/bin/env python3
"""Build TruffleHog exclude file. Prefer: ./trufflehog/update-excludes.sh from repo root."""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Fixed patterns (Go regexp syntax, one logical rule per line after strip).
STATIC_PATTERNS = r"""
# Lock files and checksums (contain hashes, not secrets)
path:go\.sum$
path:go\.mod$

# Dependency manifests (contain URLs that trigger false positives)
path:package\.json$
path:package-lock\.json$
path:pnpm-lock\.yaml$
path:yarn\.lock$
path:poetry\.lock$
path:Pipfile\.lock$
path:uv\.lock$
path:Cargo\.lock$
path:Gemfile\.lock$

# Grafana plugin metadata
path:grafana\.json$
"""


def prefix_to_regex(prefix: str) -> str:
    """Match a path segment path in repo-relative, ./, and absolute CI paths."""
    p = prefix.strip().strip("/").replace("\\", "/")
    if not p:
        return ""
    escaped = re.escape(p)
    return rf"(^|\./|[/\\]){escaped}([/\\]|$)"


def main() -> None:
    here = Path(__file__).resolve().parent
    prefixes_path = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "prefixes.txt"

    lines: list[str] = []
    lines.append(
        "# Generated — do not edit by hand. Edit trufflehog/prefixes.txt then run ./trufflehog/update-excludes.sh\n"
        "#\n"
    )

    lines.append("# --- directory prefixes (from prefixes.txt) ---\n")
    for raw in prefixes_path.read_text().splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        rx = prefix_to_regex(stripped)
        if rx:
            lines.append(f"# prefix: {stripped}\n{rx}\n")

    lines.append("\n# --- static path patterns ---\n")
    lines.append(STATIC_PATTERNS.strip() + "\n")

    sys.stdout.write("".join(lines))


if __name__ == "__main__":
    main()
