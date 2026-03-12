# Grafana Setup Guide for TruffleHog Integration

**Zizmor + Grafana Bench (see metrics in one go):** Use the [grafana-bench-stack](../../grafana-bench-stack/README.md) in this repo: `cd grafana-bench-stack && docker compose up -d`, then set `PROMETHEUS_PUSHGATEWAY_URL` and open the **Zizmor (Grafana Bench)** dashboard in Grafana.

## Quick Setup Options

### Option 1: Grafana Cloud (Recommended for Testing - Fastest)

1. **Sign up for Grafana Cloud** (free tier available)
   - Go to https://grafana.com/auth/sign-up/create-user
   - Create a free account (no credit card required for free tier)

2. **Get your Loki credentials:**
   - Go to https://grafana.com/orgs/YOUR_ORG/connections/loki
   - Click "Send logs" → "Push logs"
   - Copy:
     - **LOKI_URL**: `https://logs-prod-XXX.grafana.net/loki/api/v1/push`
     - **LOKI_USERNAME**: Your Grafana Cloud username (usually an ID like `123456`)
     - **LOKI_PASSWORD**: Your API token (create one at https://grafana.com/orgs/YOUR_ORG/api-keys)

3. **Get your Prometheus Pushgateway:**
   - Go to https://grafana.com/orgs/YOUR_ORG/connections/prometheus
   - Click "Send metrics" → "Remote write"
   - You'll need to set up a Prometheus instance or use a remote write endpoint
   - **Alternative**: Use a standalone Prometheus Pushgateway (see Option 2)

### Option 2: Local Docker Setup (For Testing)

Run these commands to set up local instances:

```bash
# Start Loki
docker run -d --name loki -p 3100:3100 grafana/loki:latest

# Start Prometheus Pushgateway
docker run -d --name pushgateway -p 9091:9091 prom/pushgateway:latest

# Start Grafana (optional, for visualization)
docker run -d --name grafana -p 3000:3000 grafana/grafana:latest
```

Then use:
- **LOKI_URL**: `http://localhost:3100` (or your server IP)
- **PROMETHEUS_PUSHGATEWAY_URL**: `http://localhost:9091` (or your server IP)

**Note**: For GitHub Actions to reach these, you'll need to expose them publicly (use ngrok, or deploy to a cloud server).

### Option 3: Use Existing Grafana Instance

If you already have Grafana/Loki/Prometheus:
- **LOKI_URL**: Your Loki instance URL (e.g., `https://loki.yourcompany.com`)
- **LOKI_USERNAME**: Your Loki username (if auth required)
- **LOKI_PASSWORD**: Your Loki password/token
- **PROMETHEUS_PUSHGATEWAY_URL**: Your Pushgateway URL (e.g., `https://pushgateway.yourcompany.com`)

## Adding Secrets to GitHub

### For Testing (Repository Secrets - Quickest)

1. Go to your repository: `https://github.com/YOUR_ORG/security-github-actions`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these secrets:

   - **Name**: `LOKI_URL`
     **Value**: Your Loki URL (e.g., `https://logs-prod-XXX.grafana.net/loki/api/v1/push`)

   - **Name**: `LOKI_USERNAME`
     **Value**: Your Loki username (Grafana Cloud user ID)

   - **Name**: `LOKI_PASSWORD`
     **Value**: Your Loki API token/password

   - **Name**: `PROMETHEUS_PUSHGATEWAY_URL`
     **Value**: Your Pushgateway URL (e.g., `http://localhost:9091` or your cloud URL)

### For Production (Organization Secrets - Recommended)

1. Go to your organization: `https://github.com/organizations/YOUR_ORG/settings/secrets/actions`
2. Click **New organization secret**
3. Add the same secrets as above

## Setting Up Grafana Dashboards

### 1. Add Data Sources

#### Add Loki Data Source:
1. In Grafana, go to **Configuration** → **Data sources**
2. Click **Add data source** → Select **Loki**
3. Enter your Loki URL
4. If using Grafana Cloud, use the credentials from step 2 above
5. Click **Save & test**

#### Add Prometheus Data Source:
1. Go to **Configuration** → **Data sources**
2. Click **Add data source** → Select **Prometheus**
3. Enter your Prometheus URL (the one scraping the Pushgateway)
4. Click **Save & test**

### 2. Create Dashboard

1. Go to **Dashboards** → **New** → **New dashboard**
2. Click **Add visualization**

#### Panel 1: Total Secrets Over Time (Prometheus)
- **Data source**: Prometheus
- **Query**:
  ```promql
  sum(trufflehog_secrets_total) by (repository)
  ```
- **Visualization**: Time series
- **Title**: "Total Secrets Found by Repository"

#### Panel 2: Verified vs Unverified (Prometheus)
- **Data source**: Prometheus
- **Query A**:
  ```promql
  sum(trufflehog_secrets_verified) by (repository)
  ```
- **Query B**:
  ```promql
  sum(trufflehog_secrets_unverified) by (repository)
  ```
- **Visualization**: Time series
- **Title**: "Verified vs Unverified Secrets"

#### Panel 3: Secrets by Detector Type (Prometheus)
- **Data source**: Prometheus
- **Query**:
  ```promql
  sum(trufflehog_secrets_by_detector_*) by (detector)
  ```
- **Visualization**: Bar chart or Pie chart
- **Title**: "Secrets by Detector Type"

#### Panel 4: Recent Findings Table (Loki)
- **Data source**: Loki
- **Query**:
  ```logql
  {job="trufflehog"}
  ```
- **Visualization**: Table or Logs
- **Title**: "Recent Secret Findings"

#### Panel 5: Findings Count Over Time (Loki)
- **Data source**: Loki
- **Query**:
  ```logql
  count_over_time({job="trufflehog"}[1h])
  ```
- **Visualization**: Time series
- **Title**: "Findings Count (Last Hour)"

### 3. Useful Loki Queries for Filtering

**Verified secrets only:**
```logql
{job="trufflehog", verified="true"}
```

**By specific repository:**
```logql
{job="trufflehog", repository="your-repo-name"}
```

**By detector type:**
```logql
{job="trufflehog", detector="aws"}
```

**Combined filter:**
```logql
{job="trufflehog", verified="true", repository="your-repo-name"}
```

## Testing the Integration

1. **Trigger a workflow** that uses the TruffleHog reusable workflow
2. **Check workflow logs** for:
   - "✅ Successfully sent X findings to Loki"
   - "✅ Successfully sent X metrics to Prometheus"
3. **Check Grafana**:
   - Loki: Query `{job="trufflehog"}` - you should see log entries
   - Prometheus: Query `trufflehog_secrets_total` - you should see metrics

## Troubleshooting

### No data appearing in Grafana

1. **Check GitHub Actions logs:**
   - Look for errors in the "Send findings to Loki" or "Send metrics to Prometheus" steps
   - Verify secrets are set correctly

2. **Verify URLs are accessible:**
   - Test Loki URL: `curl -u USERNAME:PASSWORD https://your-loki-url/ready`
   - Test Pushgateway: `curl http://your-pushgateway-url/metrics`

3. **Check Prometheus is scraping Pushgateway:**
   - If using Prometheus, ensure it's configured to scrape the Pushgateway
   - Check Prometheus targets page

4. **Verify data format:**
   - Check Loki logs: Query `{job="trufflehog"}` should return entries
   - Check Prometheus metrics: Query `trufflehog_secrets_total` should return values

### Common Issues

- **401 Unauthorized**: Check LOKI_USERNAME and LOKI_PASSWORD are correct
- **Connection refused**: Verify URLs are correct and accessible from GitHub Actions runners
- **No metrics in Prometheus**: Ensure Prometheus is scraping the Pushgateway endpoint

## Quick Test Script

You can test the scripts locally:

```bash
# Set environment variables
export LOKI_URL="https://your-loki-url"
export LOKI_USERNAME="your-username"
export LOKI_PASSWORD="your-password"
export REPOSITORY="test/repo"
export COMMIT_SHA="abc123"
export BRANCH="main"
export TRUFFLEHOG_RESULTS_FILE="results.json"

# Create a test results.json
echo '[{"DetectorName": "AWS", "Verified": true, "SourceMetadata": {"Data": {"Filesystem": {"file": "test.txt", "line": 1}}}, "Redacted": "test"}]' > results.json

# Test Loki script
python trufflehog/send-to-loki.py

# Test Prometheus script
export PROMETHEUS_PUSHGATEWAY_URL="http://your-pushgateway-url"
python trufflehog/send-to-prometheus.py
```
