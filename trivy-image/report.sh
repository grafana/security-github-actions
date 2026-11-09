#!/usr/bin/env bash
# Render a Trivy JSON report (and optional baseline report) as Markdown on stdout
# and write counts to $GITHUB_OUTPUT when set.
#
# Environment:
#   REPORT_PATH         Trivy JSON report for the image under test (required)
#   BASELINE_REPORT     Trivy JSON report for the baseline image (optional)
#   BASELINE_SOURCE     image | cache | artifact | none
#   BASELINE_IMAGE_REF  Baseline image reference when BASELINE_SOURCE=image
#   IMAGE_REF, IMAGE_NAME, SLUG, SEVERITY, IGNORE_UNFIXED, SBOM_CACHE_HIT,
#   BASELINE_REF, TRIVY_BIN_VERSION, MAX_ROWS
set -euo pipefail

: "${REPORT_PATH:?REPORT_PATH is required}"
BASELINE_REPORT="${BASELINE_REPORT:-}"
BASELINE_SOURCE="${BASELINE_SOURCE:-none}"
BASELINE_IMAGE_REF="${BASELINE_IMAGE_REF:-}"
IMAGE_REF="${IMAGE_REF:-unknown}"
IMAGE_NAME="${IMAGE_NAME:-${IMAGE_REF}}"
SLUG="${SLUG:-image}"
SEVERITY="${SEVERITY:-CRITICAL,HIGH}"
IGNORE_UNFIXED="${IGNORE_UNFIXED:-false}"
SBOM_CACHE_HIT="${SBOM_CACHE_HIT:-false}"
BASELINE_REF="${BASELINE_REF:-}"
TRIVY_BIN_VERSION="${TRIVY_BIN_VERSION:-}"
MAX_ROWS="${MAX_ROWS:-100}"

if ! [[ "${MAX_ROWS}" =~ ^[0-9]+$ ]]; then
  echo "::warning::max-rows must be a non-negative integer (got '${MAX_ROWS}'); using 100." >&2
  MAX_ROWS=100
fi

# A baseline report that is missing or malformed degrades to "no baseline".
if [[ -n "${BASELINE_REPORT}" ]] && jq -e . "${BASELINE_REPORT}" >/dev/null 2>&1; then
  baseline_arg=(--slurpfile base "${BASELINE_REPORT}")
else
  if [[ -n "${BASELINE_REPORT}" ]]; then
    echo "::warning::Baseline report is unreadable; showing results without a diff." >&2
  fi
  baseline_arg=(--argjson base '[]')
fi

summary_path="$(dirname "${REPORT_PATH}")/summary.json"

jq -n \
  --slurpfile pr "${REPORT_PATH}" \
  "${baseline_arg[@]}" \
  '
  def rank: {CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3}[.] // 4;
  def vulns:
    [ .Results[]? | .Type as $type
      | .Vulnerabilities[]?
      | { id: .VulnerabilityID,
          pkg: .PkgName,
          installed: (.InstalledVersion // ""),
          fixed: (.FixedVersion // ""),
          severity: (.Severity // "UNKNOWN"),
          url: (.PrimaryURL // ""),
          type: ($type // ""),
          key: (.VulnerabilityID + "|" + .PkgName + "|" + (.PkgPath // "")) } ]
    | unique_by(.key)
    | sort_by((.severity | rank), .id, .pkg);
  def count($s): map(select(.severity == $s)) | length;
  def key_set: map({key: .key, value: true}) | from_entries;

  ($pr[0] | vulns) as $cur
  | (if ($base | length) > 0 then ($base[0] | vulns) else null end) as $baseVulns
  | ($cur | key_set) as $curSet
  | (if $baseVulns == null then {} else ($baseVulns | key_set) end) as $baseSet
  | {
      os: ($pr[0].Metadata.OS | if . == null then "" else "\(.Family) \(.Name)" end),
      findings: $cur,
      critical: ($cur | count("CRITICAL")),
      high: ($cur | count("HIGH")),
      medium: ($cur | count("MEDIUM")),
      low: ($cur | count("LOW")),
      total: ($cur | length),
      fixable: ($cur | map(select(.fixed != "")) | length),
      baseline_found: ($baseVulns != null),
      introduced: (if $baseVulns == null then null else ($cur | map(select(.key as $k | ($baseSet | has($k)) | not))) end),
      resolved: (if $baseVulns == null then null else ($baseVulns | map(select(.key as $k | ($curSet | has($k)) | not))) end)
    }
  ' > "${summary_path}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  jq -r '
    "critical=\(.critical)",
    "high=\(.high)",
    "medium=\(.medium)",
    "low=\(.low)",
    "total=\(.total)",
    "fixable=\(.fixable)",
    "baseline-found=\(.baseline_found)",
    "introduced=\(.introduced | if . == null then "" else length end)",
    "resolved=\(.resolved | if . == null then "" else length end)"
  ' "${summary_path}" >> "${GITHUB_OUTPUT}"
fi

jq -r \
  --arg image_ref "${IMAGE_REF}" \
  --arg image_name "${IMAGE_NAME}" \
  --arg slug "${SLUG}" \
  --arg severity "${SEVERITY}" \
  --arg ignore_unfixed "${IGNORE_UNFIXED}" \
  --arg cache_hit "${SBOM_CACHE_HIT}" \
  --arg baseline_ref "${BASELINE_REF}" \
  --arg baseline_source "${BASELINE_SOURCE}" \
  --arg baseline_image_ref "${BASELINE_IMAGE_REF}" \
  --arg trivy_version "${TRIVY_BIN_VERSION}" \
  --argjson max_rows "${MAX_ROWS}" \
  '
  # Report fields come from the image and the vulnerability DB, so treat them as untrusted:
  # escape Markdown/HTML metacharacters and only link to plain https URLs.
  def esc: tostring | gsub("\r|\n"; " ") | gsub("(?<c>[\\\\`*_{}\\[\\]()#+!|<>~])"; "\\\(.c)");
  def html: tostring | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;")
    | gsub("`"; "&#96;") | gsub("\\*"; "&#42;") | gsub("_"; "&#95;") | gsub("~"; "&#126;") | gsub("\\["; "&#91;")
    | gsub("\\|"; "\\|") | gsub("\r|\n"; " ");
  def code: if . == "" then "—" else "<code>" + html + "</code>" end;
  def safe_url:
    if test("^https://[A-Za-z0-9._~:/?#@!$&'"'"'*+,;=%()-]+$") then gsub("\\("; "%28") | gsub("\\)"; "%29") else "" end;
  def link: (.url | safe_url) as $u | if $u == "" then (.id | esc) else "[\(.id | esc)](\($u))" end;
  def row: "| \(.severity | esc) | \(link) | \(.pkg | code) | \(.installed | code) | \(.fixed | code) | \(.type | esc) |";
  def table:
    if length == 0 then "_none_"
    else
      ( "| Severity | Vulnerability | Package | Installed | Fixed | Type |",
        "|---|---|---|---|---|---|",
        (.[:$max_rows][] | row),
        (if length > $max_rows then "", "_… and \(length - $max_rows) more (see job summary or re-run with a higher `max-rows`)._" else empty end)
      )
    end;
  def vuln_count: if . == 1 then "1 vulnerability" else "\(.) vulnerabilities" end;
  def baseline_heading:
    if $baseline_source == "image" then "#### Changes compared to image `\($baseline_image_ref)`"
    elif $baseline_source == "artifact" then "#### Changes compared to `\($baseline_ref)` (baseline artifact)"
    else "#### Changes compared to `\($baseline_ref)` (cached baseline)"
    end;

  "### Trivy image scan: `\($image_name)`",
  "",
  "**Image:** `\($image_ref)`"
    + (if .os != "" then " · **OS:** \(.os | esc)" else "" end)
    + (if $trivy_version != "" then " · **Trivy:** \($trivy_version)" else "" end)
    + " · **SBOM:** " + (if $cache_hit == "true" then "restored from cache (image layers unchanged)" else "generated" end),
  "",
  "**Findings at \($severity)"
    + (if $ignore_unfixed == "true" then ", fixed only" else "" end)
    + ":** \(.critical) critical · \(.high) high"
    + (if .medium > 0 then " · \(.medium) medium" else "" end)
    + (if .low > 0 then " · \(.low) low" else "" end)
    + " · \(.fixable) with a fix available",
  "",
  (if .baseline_found then
      baseline_heading,
      "",
      (if (.introduced | length) == 0 and (.resolved | length) == 0 then
        "No vulnerabilities introduced or resolved by this change."
       else
        ("**Introduced (\(.introduced | length))**", "", (.introduced | table), "",
         "**Resolved (\(.resolved | length))**", "", (.resolved | table))
       end)
   elif $baseline_ref != "" or $baseline_image_ref != "" then
      "_No baseline available"
        + (if $baseline_ref != "" then " for `\($baseline_ref)`" else "" end)
        + ", so introduced/resolved vulnerabilities cannot be shown. A baseline is saved when this action runs on a push to the base branch (cache + 90-day artifact), or pass `baseline-image-ref` to diff against a specific image._"
   else empty
   end),
  "",
  "<details><summary>All findings (\(.total | vuln_count))</summary>",
  "",
  (.findings | table),
  "",
  "</details>",
  "",
  "_Informational only; this check never fails the build._",
  "<!-- trivy-image-scan:\($slug) -->"
  ' "${summary_path}"
