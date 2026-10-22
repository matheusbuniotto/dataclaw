import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import {
    groupIntoTurns,
    parseTabularOutput,
    toolCategory,
    MarkdownView,
    AssistantTurnView,
    ToolInvocationCard,
} from "../src/console/components/ChatComponents";
import { transcriptFrom, buildTurns } from "../src/console/api/workspace";
import type { TranscriptItem } from "../src/console/state/workspace-types";

describe("Chat UI Improvements", () => {
    it("groups transcript items into user and assistant turns with toolings", () => {
        const transcript: TranscriptItem[] = [
            { id: "u-1", role: "user", text: "Analyze bakery sales", time: "9:00 AM" },
            {
                id: "a-1",
                role: "assistant",
                text: "",
                thinking: "I should run a SQL query first.",
                tools: [
                    {
                        id: "call-1",
                        callId: "call-1",
                        toolName: "query_data",
                        summary: "SELECT * FROM sales",
                        args: { sql: "SELECT * FROM sales" },
                        status: "completed",
                        resultText: "id | total\n---+------\n1  | 100",
                        isError: false,
                        durationMs: 45,
                    },
                ],
                time: "9:01 AM",
            },
            {
                id: "a-2",
                role: "assistant",
                text: "Here is the **sales** analysis:\n\n- Peak at 2pm",
                time: "9:01 AM",
            },
        ];

        const turns = groupIntoTurns(transcript);
        expect(turns.length).toBe(2);

        expect(turns[0]!.role).toBe("user");
        expect(turns[0]!.userText).toBe("Analyze bakery sales");

        expect(turns[1]!.role).toBe("assistant");
        expect(turns[1]!.thinking).toContain("I should run a SQL query first.");
        expect(turns[1]!.tools.length).toBe(1);
        expect(turns[1]!.tools[0]!.toolName).toBe("query_data");
        expect(turns[1]!.assistantText).toContain("Here is the **sales** analysis:");
        expect(turns[1]!.segments?.map((segment) => segment.kind)).toEqual(["thinking", "tools", "text"]);
    });

    it("parses tabular SQL and ASCII outputs into structured headers and rows", () => {
        const sqlOutput = `
country     | count | pct
------------+-------+----
Japan       | 20    | 40%
US          | 16    | 32%
Australia   | 6     | 12%

(3 rows)
`;
        const parsed = parseTabularOutput(sqlOutput);
        expect(parsed).not.toBeNull();
        expect(parsed!.headers).toEqual(["country", "count", "pct"]);
        expect(parsed!.rows.length).toBe(3);
        expect(parsed!.rows[0]).toEqual(["Japan", "20", "40%"]);
        expect(parsed!.rowCountNote).toBe("(3 rows)");
    });

    it("categorizes tools with matching icons and color themes", () => {
        expect(toolCategory("query_data").category).toBe("db");
        expect(toolCategory("discover_data").category).toBe("db");
        expect(toolCategory("bash").category).toBe("terminal");
        expect(toolCategory("read").category).toBe("file");
        expect(toolCategory("write").category).toBe("file");
        expect(toolCategory("record_finding").category).toBe("audit");
        expect(toolCategory("request_auditor_review").category).toBe("audit");
        expect(toolCategory("unknown_tool").category).toBe("other");
    });

    it("renders markdown elements: headings, bold, inline code, tables, and alerts", () => {
        const markdown = `
# Summary Header
This is **important** and uses \`SELECT 1\`.

> [!NOTE]
> Ensure Databricks warehouse is running.

| Metric | Value |
|---|---|
| Total | 100 |

1. Step one
2. Step two
`;
        const html = renderToString(React.createElement(MarkdownView, { content: markdown }));
        expect(html).toContain("Summary Header");
        expect(html).toContain("<strong>important</strong>");
        expect(html).toContain("chat-inline-code");
        expect(html).toContain("chat-alert-info");
        expect(html).toContain("chat-markdown-table");
        expect(html).toContain("Total");
        expect(html).toContain("chat-list-ordered");
    });

    it("renders complete AssistantTurnView with tools and thinking", () => {
        const turn = {
            id: "turn-1",
            role: "assistant" as const,
            time: "9:05 AM",
            thinking: "Evaluating customer churn drivers",
            tools: [
                {
                    id: "tool-1",
                    callId: "tool-1",
                    toolName: "bash",
                    summary: "ls -la sample-data/",
                    args: { command: "ls -la sample-data/" },
                    status: "completed" as const,
                    resultText: "customer_churn.csv\nincident_logs.json",
                    durationMs: 18,
                },
            ],
            assistantText: "The directory contains `customer_churn.csv`.",
        };

        const html = renderToString(React.createElement(AssistantTurnView, { turn, live: false }));
        expect(html).toContain("Thought");
        expect(html).toContain("Evaluating customer churn drivers");
        expect(html).toContain("Ran command");
        expect(html).toContain("bash");
        expect(html).toContain("ls -la sample-data/");

        const cardHtml = renderToString(
            React.createElement(ToolInvocationCard, { tool: turn.tools[0]!, defaultOpen: true })
        );
        expect(cardHtml).toContain("tool-name-badge");
        expect(cardHtml).toContain("bash");
        expect(cardHtml).toContain("Call · Shell");
        expect(cardHtml).toContain("customer_churn.csv");
    });

    it("keeps a later thought after the call that prompted it", () => {
        const turns = groupIntoTurns([
            { id: "u", role: "user", text: "Check churn", time: "9:00 AM" },
            {
                id: "a1",
                role: "assistant",
                text: "",
                thinking: "Profile the file first.",
                tools: [{
                    id: "t1",
                    callId: "t1",
                    toolName: "read",
                    summary: "prototype/SKILL.md",
                    args: { path: "/workspace/.agents/skills/prototype/SKILL.md" },
                    status: "completed",
                    resultText: "# Prototype",
                }],
                time: "9:01 AM",
            },
            {
                id: "a2",
                role: "assistant",
                text: "",
                thinking: "The skill says to explore before claiming.",
                tools: [{
                    id: "t2",
                    callId: "t2",
                    toolName: "query_data",
                    summary: "SELECT 1",
                    args: { sql: "SELECT 1", rationale: "Confirm the warehouse answers." },
                    status: "completed",
                    resultText: "1\n-\n1",
                }],
                time: "9:02 AM",
            },
            { id: "a3", role: "assistant", text: "Warehouse is up.", time: "9:02 AM" },
        ]);

        expect(turns[1]!.segments?.map((segment) => segment.kind)).toEqual([
            "thinking",
            "tools",
            "thinking",
            "tools",
            "text",
        ]);

        const html = renderToString(React.createElement(AssistantTurnView, { turn: turns[1]!, live: false }));
        const thought = html.indexOf("Profile the file first.");
        const skill = html.indexOf("Read instructions");
        const followup = html.indexOf("The skill says to explore before claiming.");
        const query = html.indexOf("Queried the data source");
        const answer = html.indexOf("Warehouse is up.");
        expect(thought).toBeGreaterThan(-1);
        expect(thought).toBeLessThan(skill);
        expect(skill).toBeLessThan(followup);
        expect(followup).toBeLessThan(query);
        expect(query).toBeLessThan(answer);

        const queryCard = renderToString(
            React.createElement(ToolInvocationCard, { tool: turns[1]!.tools[1]!, defaultOpen: true })
        );
        expect(queryCard).toContain("Instruction");
        expect(queryCard).toContain("Confirm the warehouse answers.");
        expect(queryCard).toContain("Call · SQL");
    });

    it("does not report in-flight Databricks calls as unavailable error before result arrives", () => {
        const messagesWithSyntheticMissing = [
            { role: "user", content: "Count trips", timestamp: 1000 },
            {
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: "call-db-1",
                        name: "query_data",
                        arguments: { sql: "SELECT COUNT(*) FROM samples.nyctaxi.trips", rationale: "Get trip count" },
                    },
                ],
                timestamp: 1001,
            },
            {
                role: "toolResult",
                toolCallId: "call-db-1",
                toolName: "query_data",
                content: [{ type: "text", text: "Tool result unavailable: history ends before this call completed." }],
                isError: true,
                details: { reason: "missing_result" },
                timestamp: 1001,
            },
        ];

        // 1. transcriptFrom should treat the tool as running and omit the unavailable error
        const items = transcriptFrom(messagesWithSyntheticMissing);
        expect(items.length).toBe(2); // user and assistant, no standalone synthetic toolResult item
        const assistantItem = items[1]!;
        expect(assistantItem.tools).toBeDefined();
        expect(assistantItem.tools!.length).toBe(1);
        const toolInvocation = assistantItem.tools![0]!;
        expect(toolInvocation.toolName).toBe("query_data");
        expect(toolInvocation.status).toBe("running");
        expect(toolInvocation.isError).toBeUndefined();
        expect(toolInvocation.resultText).toBeUndefined();

        // 2. buildTurns should not set turn.error or overwrite checkpoint summary with missing result text
        const turns = buildTurns(messagesWithSyntheticMissing);
        expect(turns.length).toBe(1);
        expect(turns[0]!.error).toBeUndefined();
        const checkpoint = turns[0]!.checkpoints.find((c) => c.label === "query_data");
        expect(checkpoint).toBeDefined();
        expect(checkpoint!.summary).not.toContain("Tool result unavailable");

        // 3. ToolInvocationCard should render with Calling and no Failed error badge or box
        const cardHtml = renderToString(
            React.createElement(ToolInvocationCard, { tool: toolInvocation, defaultOpen: true })
        );
        expect(cardHtml).toContain("Calling");
        expect(cardHtml).toContain("Querying the data source");
        expect(cardHtml).not.toContain("Failed");
        expect(cardHtml).not.toContain("Tool result unavailable: history ends before this call completed.");

        // 4. When real result arrives, it replaces the running state with completed result
        const messagesWithRealResult = [
            messagesWithSyntheticMissing[0]!,
            messagesWithSyntheticMissing[1]!,
            {
                role: "toolResult",
                toolCallId: "call-db-1",
                toolName: "query_data",
                content: [{ type: "text", text: "count\n-----\n1000000" }],
                isError: false,
                timestamp: 1005,
            },
        ];

        const updatedItems = transcriptFrom(messagesWithRealResult);
        const updatedTool = updatedItems[1]!.tools![0]!;
        expect(updatedTool.status).toBe("completed");
        expect(updatedTool.resultText).toBe("count\n-----\n1000000");

        const completedCardHtml = renderToString(
            React.createElement(ToolInvocationCard, { tool: updatedTool, defaultOpen: true })
        );
        expect(completedCardHtml).not.toContain("Calling");
        expect(completedCardHtml).toContain("Queried the data source");
        expect(completedCardHtml).toContain("1000000");
    });
});
