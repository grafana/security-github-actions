#!/usr/bin/env bash
# Format semgrep JSON results into a GitHub-flavored markdown comment.
set -euo pipefail

INPUT_FILE="$1"

RESULTS_COUNT=$(jq '.results | length' "$INPUT_FILE")

if [ "$RESULTS_COUNT" -eq 0 ]; then
  exit 0
fi

echo "## Semgrep Findings"
echo ""
echo "**${RESULTS_COUNT}** finding(s) detected."
echo ""
echo "| Severity | Rule | File | Message |"
echo "|----------|------|------|---------|"

jq -r --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" '.results[] | {
  sev: .extra.severity,
  rule: (.check_id | split(".")[-1]),
  path: .path,
  line: .start.line,
  msg: (.extra.message | gsub("\n"; " ") | ltrimstr(" ") | rtrimstr(" ") | gsub("\\|"; "\\|") | gsub("`"; "\\`"))
} | {
  icon: (if .sev == "CRITICAL" then "🔴"
         elif .sev == "HIGH" then "🟠"
         elif .sev == "MEDIUM" then "🟡"
         elif .sev == "LOW" then "🔵"
         elif .sev == "INFO" then "⚪"
         else "⚪" end),
  sev: .sev,
  rule: .rule,
  path: .path,
  line: .line,
  msg: .msg
} | "| \(.icon) \(.sev) | `\(.rule)` | [`\(.path):\(.line)`](https://github.com/\($repo)/blob/\($sha)/\(.path)#L\(.line)) | \(.msg) |"' "$INPUT_FILE"
