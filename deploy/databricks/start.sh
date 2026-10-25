#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "  DATACLAW: BOOTING ON DATABRICKS APPS"
echo "=========================================================="

# Ensure Bun is available.
# 1. Check if bun is already on PATH
# 2. Check if bun was installed into ./node_modules/.bin/bun
# 3. Check if bun is in ~/.bun/bin
# 4. Otherwise, download and install bun via official installer
if ! command -v bun >/dev/null 2>&1; then
    if [ -x "./node_modules/.bin/bun" ]; then
        export PATH="$(pwd)/node_modules/.bin:$PATH"
    elif [ -x "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    else
        echo "[Databricks Apps] Installing Bun runtime..."
        curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || true
        export PATH="$HOME/.bun/bin:$PATH"
    fi
fi

if ! command -v bun >/dev/null 2>&1; then
    echo "[Databricks Apps] Error: Bun runtime could not be located or installed." >&2
    exit 1
fi

echo "[Databricks Apps] Using Bun: $(bun --version)"
echo "[Databricks Apps] Host: ${HOST:-0.0.0.0} | Port: ${DATABRICKS_APP_PORT:-${PORT:-3000}}"

# Execute DataClaw Console server
exec bun run src/backend/api/server.ts
