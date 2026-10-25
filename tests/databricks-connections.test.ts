import { describe, expect, test } from "bun:test";
import { DatabricksConnectionsClient } from "../src/mcp/databricks-connections";
import { parseConnectionName } from "../src/types/brands";

describe("DatabricksConnectionsClient", () => {
    test("listConnections parses connections and options", async () => {
        const mockFetch = async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/api/2.0/connections")) {
                return new Response(JSON.stringify({
                    connections: [
                        {
                            name: "salesforce_lakehouse",
                            connection_type: "SALESFORCE",
                            comment: "CRM sync",
                            created_at: 1700000000,
                        },
                        {
                            name: "customer_pg",
                            connection_type: "POSTGRESQL",
                            comment: "Production Postgres database",
                            options: {
                                host: "db.internal.net",
                                port: "5432",
                                user: "app_user",
                                database: "prod_db",
                            },
                            created_at: 1700000001,
                        },
                    ],
                }));
            }
            return new Response("{}", { status: 404 });
        };

        const client = new DatabricksConnectionsClient({
            host: "https://dbc-test.cloud.databricks.com",
            token: "dapi-test-token",
            fetchFn: mockFetch,
        });

        const list = await client.listConnections();
        expect(list.length).toBe(2);
        expect(list[0]?.name).toBe(parseConnectionName("salesforce_lakehouse"));
        expect(list[1]?.name).toBe(parseConnectionName("customer_pg"));
        expect(list[1]?.connectionType).toBe("POSTGRESQL");
        expect(list[1]?.host).toBe("db.internal.net");
        expect(list[1]?.port).toBe(5432);
    });

    test("getConnection retrieves a single connection by name", async () => {
        const mockFetch = async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("/api/2.0/connections/snowflake_dw")) {
                return new Response(JSON.stringify({
                    name: "snowflake_dw",
                    connection_type: "SNOWFLAKE",
                    comment: "Snowflake Enterprise DW",
                    options: { host: "xy12345.snowflakecomputing.com", user: "DATACLAW_RO" },
                }));
            }
            return new Response("Not found", { status: 404 });
        };

        const client = new DatabricksConnectionsClient({
            host: "https://dbc-test.cloud.databricks.com",
            token: "dapi-test-token",
            fetchFn: mockFetch,
        });

        const conn = await client.getConnection("snowflake_dw");
        expect(conn).not.toBeNull();
        expect(conn?.name).toBe(parseConnectionName("snowflake_dw"));
        expect(conn?.connectionType).toBe("SNOWFLAKE");
        expect(conn?.host).toBe("xy12345.snowflakecomputing.com");

        const missing = await client.getConnection("non_existent");
        expect(missing).toBeNull();
    });
});
