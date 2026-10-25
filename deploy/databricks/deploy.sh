#!/usr/bin/env bash
set -euo pipefail

# DataClaw: Deploy to Databricks Apps
# Usage:
#   ./deploy/databricks/deploy.sh [app-name] [target]
# Example:
#   ./deploy/databricks/deploy.sh dataclaw dev

APP_NAME="${1:-dataclaw}"
TARGET="${2:-dev}"
PROFILE="${3:-${DATABRICKS_PROFILE:-${TARGET}}}"

# Ensure profile is exported so all Databricks CLI subcommands inherit it
export DATABRICKS_PROFILE="${PROFILE}"

echo "=========================================================="
echo "  Deploying DataClaw to Databricks Apps"
echo "  App:     ${APP_NAME}"
echo "  Target:  ${TARGET}"
echo "  Profile: ${PROFILE}"
echo "=========================================================="

if ! command -v databricks >/dev/null 2>&1; then
    echo "Error: Databricks CLI is not installed or not in PATH."
    echo "Install it via: brew install databricks/tap/databricks or see https://docs.databricks.com/dev-tools/cli/index.html"
    exit 1
fi

# Check authentication
echo "Checking Databricks CLI authentication (profile: ${PROFILE})..."
if ! databricks auth describe --profile "${PROFILE}" >/dev/null 2>&1; then
    echo "Please authenticate with your Databricks workspace profile '${PROFILE}':"
    echo "  databricks auth login --profile ${PROFILE}"
    exit 1
fi

echo "Validating Databricks Asset Bundle..."
databricks bundle validate -t "${TARGET}" --profile "${PROFILE}"

echo "Deploying application to Databricks Apps via Asset Bundle..."
databricks bundle deploy -t "${TARGET}" --profile "${PROFILE}"

echo ""
echo "=========================================================="
echo "  ✓ DataClaw deployment initiated successfully!"
echo "  Target: dev/prod app running on Databricks Apps"
echo "  View status with: databricks apps get ${APP_NAME} --profile ${PROFILE}"
echo "=========================================================="
