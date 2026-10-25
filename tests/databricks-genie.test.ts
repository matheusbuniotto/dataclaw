import { describe, expect, test } from "bun:test";
import { DatabricksGenieClient } from "../src/mcp/databricks-genie";
import { parseGenieSpaceId } from "../src/types/brands";

describe("DatabricksGenieClient", () => {
    test("listSpaces returns Genie spaces", async () => {
        const mockFetch = async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/api/2.0/genie/spaces")) {
                return new Response(JSON.stringify({
                    spaces: [
                        {
                            space_id: "01ef123456789abc",
                            title: "Executive Revenue & Churn Space",
                            description: "Certified financial metrics curated by RevOps",
                            warehouse_id: "wh-12345",
                        },
                    ],
                }));
            }
            return new Response("{}", { status: 404 });
        };

        const client = new DatabricksGenieClient({
            host: "https://dbc-test.cloud.databricks.com",
            token: "dapi-test-token",
            fetchFn: mockFetch,
        });

        const spaces = await client.listSpaces();
        expect(spaces.length).toBe(1);
        expect(spaces[0]?.spaceId).toBe(parseGenieSpaceId("01ef123456789abc"));
        expect(spaces[0]?.title).toBe("Executive Revenue & Churn Space");
        expect(spaces[0]?.warehouseId).toBe("wh-12345");
    });

    test("ask starts conversation and polls until completed", async () => {
        let pollCount = 0;
        const mockFetch = async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("/start-conversation")) {
                return new Response(JSON.stringify({
                    conversation_id: "conv-999",
                    message_id: "msg-001",
                }));
            }
            if (url.includes("/messages/msg-001")) {
                pollCount++;
                if (pollCount < 2) {
                    return new Response(JSON.stringify({
                        id: "msg-001",
                        conversation_id: "conv-999",
                        status: "EXECUTING",
                    }));
                }
                return new Response(JSON.stringify({
                    id: "msg-001",
                    conversation_id: "conv-999",
                    status: "COMPLETED",
                    content: "Net ARR grew by 14.2% in Q3 with lowest churn in enterprise cohorts.",
                    attachments: [
                        {
                            query: {
                                query: "SELECT sum(arr_delta) FROM finance.arr_summary WHERE quarter = 'Q3'",
                                description: "Certified quarterly ARR calculation",
                            },
                        },
                    ],
                }));
            }
            return new Response("{}", { status: 404 });
        };

        const client = new DatabricksGenieClient({
            host: "https://dbc-test.cloud.databricks.com",
            token: "dapi-test-token",
            fetchFn: mockFetch,
        });

        const result = await client.ask(
            parseGenieSpaceId("01ef123456789abc"),
            "What was our net ARR growth in Q3?",
            5000,
        );

        expect(result.status).toBe("COMPLETED");
        expect(result.content).toContain("14.2%");
        expect(result.sqlQuery).toContain("SELECT sum(arr_delta)");
        expect(result.queryDescription).toBe("Certified quarterly ARR calculation");
        expect(pollCount).toBe(2);
    });
});
