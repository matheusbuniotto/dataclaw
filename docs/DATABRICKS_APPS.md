# Deploying DataClaw on Databricks Apps 🦀 🚀

This guide provides the complete architectural blueprint and deployment instructions for running **DataClaw** natively inside **Databricks Apps**.

---

## 1. Why Databricks Apps?

Databricks Apps is a secure, serverless runtime that hosts interactive full-stack data applications directly within your Databricks workspace perimeter:

- 🔒 **Zero Data Egress**: SQL queries against Unity Catalog execute directly within the customer's cloud boundary over Databricks' internal managed SQL MCP endpoint (`https://<workspace>/api/2.0/mcp/sql`).
- 🔑 **Native Governance & SSO**: Automatically benefits from workspace Single Sign-On (SSO), RBAC, Unity Catalog table permissions, and row/column masking.
- ⚡ **Instant Serverless Provisioning**: No Kubernetes clusters or EC2/VM infrastructure to manage; compute scales automatically.
- 🛡️ **Crash-Resilient Durability**: DataClaw's Pi Durable SQLite state machine checkpoints analytical plans, verified findings, and playbooks without losing state across turns.

---

## 2. Architectural Blueprint

```
                      ┌──────────────────────────────────────────────────────────┐
                      │              Databricks Cloud Perimeter                  │
                      │                                                          │
                      │   [Databricks Reverse Proxy / Gateway]                   │
                      │   - Authenticates End-Users via Workspace SSO            │
                      │   - Injects X-Forwarded-Access-Token header              │
                      │   - Forwards traffic to container on 0.0.0.0:$PORT       │
                      └────────────────────────────┬─────────────────────────────┘
                                                   │
                                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Databricks Apps Serverless Container                                                   │
│                                                                                        │
│  Entrypoint: `deploy/databricks/start.sh` (Auto-provisions Bun runtime)               │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ DataClaw Console Server (Bun.serve on 0.0.0.0:$DATABRICKS_APP_PORT)              │  │
│  │                                                                                  │  │
│  │  - React 19 UI: /console (Overview, Agents, Runs, Data Health, Evals & Growth)  │  │
│  │  - Route Table: /api/* (Zero-port data layer)                                    │  │
│  │  - Auth Layer:                                                                   │  │
│  │     * App Identity: Service Principal M2M OAuth (CLIENT_ID / CLIENT_SECRET)      │  │
│  │     * User Context: X-Forwarded-Access-Token OBO passthrough                     │  │
│  └─────────────────────────────────┬────────────────────────────────────────────────┘  │
│                                    │                                                   │
│                                    ▼                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Pi Durable State Engine & Storage                                                │  │
│  │                                                                                  │  │
│  │  Option A (Default): Ephemeral /tmp/agent_analyst.sqlite                         │  │
│  │  Option B (Production): Persistent Unity Catalog Volume                          │  │
│  │    `/Volumes/<catalog>/<schema>/<volume_name>/dataclaw/agent_analyst.sqlite`     │  │
│  └─────────────────────────────────┬────────────────────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────────────────────┘
                                     │ Streamable HTTP
                                     ▼
      ┌────────────────────────────────────────────────────────────────┐
      │ Databricks Managed SQL MCP Server (`/api/2.0/mcp/sql`)         │
      │ - Unity Catalog Metastore & Information Schema                 │
      │ - Serverless SQL Warehouses                                    │
      │ - Read-only AST validation & Execution                         │
      └────────────────────────────────────────────────────────────────┘
```

---

## 3. Configuration & Runtime Assets

DataClaw ships with native Databricks Apps manifests ready for deployment:

| File | Purpose |
| :--- | :--- |
| [`app.yaml`](file:///Users/matheus/Workspace/code/dataclaw/app.yaml) | Databricks Apps runtime manifest defining entrypoint command and environment. |
| [`databricks.yml`](file:///Users/matheus/Workspace/code/dataclaw/databricks.yml) | Databricks Asset Bundle (DAB) declaration for Infrastructure-as-Code deployments. |
| [`deploy/databricks/start.sh`](file:///Users/matheus/Workspace/code/dataclaw/deploy/databricks/start.sh) | Container bootstrap script ensuring Bun runtime is active and launching the console. |
| [`deploy/databricks/deploy.sh`](file:///Users/matheus/Workspace/code/dataclaw/deploy/databricks/deploy.sh) | Automated 1-click CLI deployment script. |

---

## 4. Key Deployment Considerations

### A. Dynamic Port & Network Binding
Databricks Apps assigns a dynamic port via `$DATABRICKS_APP_PORT`.
- **Host Binding**: The server **must listen on `0.0.0.0`**, not `127.0.0.1`. If bound to localhost, Databricks health checks fail.
- **Port Resolution**: `src/console/api/server.ts` automatically binds `process.env.DATABRICKS_APP_PORT || process.env.PORT || 3000`.

### B. Authentication Models
Databricks Apps supports two authentication patterns:

1. **Service Principal Identity (App-Level Identity - Recommended)**:
   - When you create an app, Databricks can assign a Service Principal to it.
   - Pass the credentials via App configuration or environment secrets:
     ```yaml
     DATABRICKS_CLIENT_ID: "<service-principal-client-id>"
     DATABRICKS_CLIENT_SECRET: "{{secrets/dataclaw/sp_client_secret}}"
     ```
   - On startup, DataClaw automatically detects these environment variables and initializes an M2M OAuth session (`DatabricksOAuthSession.fromClientCredentials`).

2. **On-Behalf-Of (OBO) User Authorization**:
   - The Databricks reverse proxy forwards the active user's OAuth token in the `X-Forwarded-Access-Token` HTTP header.
   - This ensures queries strictly respect the logged-in user's Unity Catalog permissions and row-level filtering policies.

### C. Persistent Storage across Container Restarts
Databricks Apps containers have an ephemeral file system. When the app scales down or restarts, `/tmp` is wiped.
For multi-session durability:
1. Create a Unity Catalog Volume:
   ```sql
   CREATE VOLUME main.default.dataclaw_storage;
   ```
2. Set the `ANALYST_STORAGE` environment variable in `app.yaml`:
   ```yaml
   env:
     - name: "ANALYST_STORAGE"
       value: "/Volumes/main/default/dataclaw_storage/agent_analyst.sqlite"
   ```
3. DataClaw will store its Pi Durable WAL state in this volume, persisting all plans, hypotheses, findings, and playbooks indefinitely.

---

## 5. Step-by-Step Deployment Methods

### Method 1: Automated Script (Fastest)

Ensure you have the [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) installed and authenticated:

```bash
# 1. Authenticate with your Databricks workspace
databricks auth login --host https://<your-workspace>.cloud.databricks.com

# 2. Run the deployment script
./deploy/databricks/deploy.sh dataclaw dev
```

### Method 2: Databricks Asset Bundles (DABs)

Databricks Asset Bundles provide declarative, reproducible deployments:

```bash
# Validate bundle configuration
databricks bundle validate -t dev

# Deploy the app bundle
databricks bundle deploy -t dev

# Start the app compute
databricks apps start dataclaw
```

### Method 3: Direct Databricks CLI

```bash
# 1. Create the app resource
databricks apps create dataclaw \
  --description "DataClaw: Crash-resilient data analytics agent console"

# 2. Deploy source code
databricks apps deploy dataclaw --source-code-path .

# 3. Check deployment status and obtain URL
databricks apps get dataclaw
```

### Method 4: Databricks Workspace UI

1. Open your Databricks Workspace and navigate to **Compute** > **Apps** (or **Apps** in the left sidebar).
2. Click **Create App**.
3. Set App Name to `dataclaw`.
4. Choose **Custom App** / Git repository or upload the workspace folder.
5. In **Environment Variables**, configure:
   - `ANALYST_STORAGE`: `/Volumes/<catalog>/<schema>/<volume>/agent_analyst.sqlite` (or leave default for ephemeral).
   - `DATABRICKS_WAREHOUSE_ID`: `<your-sql-warehouse-id>` (optional default warehouse).
6. Click **Deploy**. Databricks will provision the serverless container, execute `deploy/databricks/start.sh`, and display the live URL.

---

## 6. Verifying the Deployment

Once deployed:
1. Access the app URL: `https://<workspace-host>/apps/dataclaw` or `https://dataclaw.<workspace-subdomain>.databricksapps.com`.
2. Navigate to **Data Health** (`/console/data`) and **Settings** (`/console/settings`).
3. Verify that **Databricks MCP** reports `Connected: true` with your workspace catalogs and schemas visible.
4. Try an analytical query:
   ```
   "Profile the churn patterns in customer_churn table and verify statistical confidence"
   ```
5. Inspect the live turn in **Durable Runs** (`/console/runs`) and verify atomic WAL checkpointing.
