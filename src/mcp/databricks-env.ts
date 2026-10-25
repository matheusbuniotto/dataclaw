import type { DatabricksMcpConfig } from "./databricks-config";

export interface LakePostgresConfig {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username?: string;
    readonly password?: string;
    readonly ssl: boolean | "require" | "prefer";
    readonly url?: string;
}

export interface DatabricksAppContext {
    readonly isApp: boolean;
    readonly host?: string;
    readonly token?: string;
    readonly appId?: string;
    readonly appName?: string;
    readonly appPort?: number;
    readonly hasLakePostgres: boolean;
    readonly lakePostgres?: LakePostgresConfig;
}

export function isDatabricksApp(): boolean {
    return Boolean(
        process.env.DATABRICKS_APP_PORT ||
        process.env.DATABRICKS_APP_ID ||
        (process.env.DATABRICKS_HOST && process.env.DATABRICKS_TOKEN)
    );
}

export function resolveLakePostgresConfig(): LakePostgresConfig | undefined {
    const host = process.env.DATABRICKS_POSTGRES_HOST ?? process.env.PGHOST;
    const database = process.env.DATABRICKS_POSTGRES_DATABASE ?? process.env.PGDATABASE;
    const url = process.env.DATABRICKS_POSTGRES_URL ?? process.env.DATABASE_URL;

    if (!host && !url) {
        return undefined;
    }

    const portRaw = process.env.DATABRICKS_POSTGRES_PORT ?? process.env.PGPORT;
    const port = portRaw ? Number.parseInt(portRaw, 10) : 5432;
    const username = process.env.DATABRICKS_POSTGRES_USER ?? process.env.PGUSER;
    const password = process.env.DATABRICKS_POSTGRES_PASSWORD ?? process.env.PGPASSWORD;
    const sslMode = process.env.DATABRICKS_POSTGRES_SSL ?? process.env.PGSSLMODE;

    const ssl: boolean | "require" | "prefer" =
        sslMode === "disable"
            ? false
            : sslMode === "require"
            ? "require"
            : "prefer";

    return {
        host: host ?? "localhost",
        port: Number.isNaN(port) ? 5432 : port,
        database: database ?? "postgres",
        username,
        password,
        ssl,
        url,
    };
}

export function resolveDatabricksAppContext(): DatabricksAppContext {
    const isApp = isDatabricksApp();
    const host = process.env.DATABRICKS_HOST?.replace(/\/$/, "");
    const token = process.env.DATABRICKS_TOKEN;
    const appId = process.env.DATABRICKS_APP_ID;
    const appName = process.env.DATABRICKS_APP_NAME;
    const portRaw = process.env.DATABRICKS_APP_PORT ?? process.env.PORT;
    const appPort = portRaw ? Number.parseInt(portRaw, 10) : undefined;
    const lakePostgres = resolveLakePostgresConfig();

    return {
        isApp,
        host,
        token,
        appId,
        appName,
        appPort: appPort && !Number.isNaN(appPort) ? appPort : undefined,
        hasLakePostgres: lakePostgres !== undefined,
        lakePostgres,
    };
}
