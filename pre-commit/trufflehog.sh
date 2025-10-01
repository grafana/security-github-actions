#!/usr/bin/env bash
# vim: ai:ts=8:sw=8:noet
# Enhanced TruffleHog script for comprehensive secret scanning
# Part of Grafana Security GitHub Actions - Critical Security Infrastructure
set -euo pipefail

# renovate: datasource=docker depName=trufflesecurity/trufflehog
TRUFFLEHOG_DEFAULT_VERSION="3.88.29@sha256:6375b4dd7d045656bf78f52ac5a6e992eff344da9def96f0953cda26f791ffb7"
TRUFFLEHOG_VERSION="${TRUFFLEHOG_VERSION:-${TRUFFLEHOG_DEFAULT_VERSION}}"

# Configuration
SCAN_SINCE="${TRUFFLEHOG_SINCE_COMMIT:-HEAD}"
RESULTS_FILTER="${TRUFFLEHOG_RESULTS:-verified,unknown}"
LOG_LEVEL="${TRUFFLEHOG_LOG_LEVEL:--1}"
FAIL_ON_FINDINGS="${TRUFFLEHOG_FAIL:-true}"
EXCLUDE_PATHS="${TRUFFLEHOG_EXCLUDE_PATHS:-*.lock,*.sum,node_modules/**,vendor/**,.git/**}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔍 Starting TruffleHog Secret Scan${NC}"
echo "Version: $TRUFFLEHOG_VERSION"
echo "Scan since: $SCAN_SINCE"
echo "Results filter: $RESULTS_FILTER"

# Create custom patterns for Grafana-specific secrets
cat > /tmp/grafana-patterns.yml << 'EOF'
# Grafana-specific secret patterns
detectors:
  - name: grafana-api-key
    keywords:
      - grafana
      - api
      - key
    regex:
      glsa_[A-Za-z0-9]{32}_[A-Za-z0-9]{8}
    verify:
      - endpoint: https://grafana.com/api/
        unsafe: true
  
  - name: grafana-cloud-token
    keywords:
      - grafana
      - cloud
      - token
    regex:
      glc_[A-Za-z0-9]{32}
    verify:
      - endpoint: https://grafana.com/api/
        unsafe: true
  
  - name: canary-token
    keywords:
      - canary
      - honeypot
      - trap
    regex:
      canary_[A-Za-z0-9]{32}
    verify:
      - endpoint: http://canarytokens.org/
        unsafe: true
EOF

# Build exclude paths arguments
EXCLUDE_ARGS=""
if [[ -n "$EXCLUDE_PATHS" ]]; then
    IFS=',' read -ra PATHS <<< "$EXCLUDE_PATHS"
    for path in "${PATHS[@]}"; do
        EXCLUDE_ARGS+=" --exclude-paths=${path}"
    done
fi

# Run TruffleHog with enhanced configuration
echo -e "${YELLOW}Running scan...${NC}"

scan_exit_code=0
docker \
    run \
    --volume "$(pwd):/workdir" \
    --volume "/tmp/grafana-patterns.yml:/config/grafana-patterns.yml" \
    --interactive \
    --rm \
    "trufflesecurity/trufflehog:$TRUFFLEHOG_VERSION" \
    git \
    file:///workdir \
    --since-commit "$SCAN_SINCE" \
    --results="$RESULTS_FILTER" \
    --log-level="$LOG_LEVEL" \
    --config=/config/grafana-patterns.yml \
    --json \
    $EXCLUDE_ARGS \
    > /tmp/trufflehog-results.json 2>/dev/null || scan_exit_code=$?

# Process results
if [[ -f "/tmp/trufflehog-results.json" ]]; then
    verified_count=$(jq -r 'select(.Verified == true) | .DetectorName' /tmp/trufflehog-results.json 2>/dev/null | wc -l || echo "0")
    unknown_count=$(jq -r 'select(.Verified == false) | .DetectorName' /tmp/trufflehog-results.json 2>/dev/null | wc -l || echo "0")
    canary_count=$(jq -r 'select(.DetectorName | test("canary|honeypot|trap"; "i")) | .DetectorName' /tmp/trufflehog-results.json 2>/dev/null | wc -l || echo "0")
    
    echo -e "${GREEN}📊 Scan Results:${NC}"
    echo "  Verified secrets: $verified_count"
    echo "  Unknown secrets: $unknown_count"
    echo "  Canary tokens: $canary_count"
    
    # Critical alert for canary tokens
    if [[ $canary_count -gt 0 ]]; then
        echo -e "${RED}🚨 CRITICAL ALERT: CANARY TOKEN DETECTED 🚨${NC}"
        echo -e "${RED}This may indicate a security breach or unauthorized access!${NC}"
        exit 1
    fi
    
    # Handle findings based on configuration
    if [[ "$FAIL_ON_FINDINGS" == "true" && ($verified_count -gt 0 || $unknown_count -gt 0) ]]; then
        echo -e "${RED}❌ Secrets detected - failing as configured${NC}"
        exit $scan_exit_code
    elif [[ $verified_count -gt 0 || $unknown_count -gt 0 ]]; then
        echo -e "${YELLOW}⚠️  Secrets detected but not failing (TRUFFLEHOG_FAIL=false)${NC}"
    else
        echo -e "${GREEN}✅ No secrets detected${NC}"
    fi
else
    echo -e "${GREEN}✅ No secrets detected${NC}"
fi

# Cleanup
rm -f /tmp/grafana-patterns.yml /tmp/trufflehog-results.json

echo -e "${GREEN}🔍 TruffleHog scan completed${NC}"
