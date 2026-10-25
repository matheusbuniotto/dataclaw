import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { resolveDatabricksAppContext } from "../mcp/databricks-env";
import { DatabricksMlflowClient } from "../mcp/databricks-mlflow";
import { DatabricksSystemAiClient } from "../mcp/databricks-system-ai";
import { DatabricksConnectionsClient } from "../mcp/databricks-connections";
import { DatabricksGenieClient } from "../mcp/databricks-genie";
import { parseGenieSpaceId } from "../types/brands";
import type { DataSourceRegistry } from "../datasource/session";
import type { DatabricksDataAdapter } from "../adapters/databricks-adapter";
import type { ConversationId } from "@earendil-works/pi-durable";

function textResult(text: string) {
    const blocks = [{ type: "text" as const, text }];
    return { output: blocks, content: blocks };
}

export function createDatabricksFeatureTools(options: { sessions: () => DataSourceRegistry }) {
    const getContext = () => resolveDatabricksAppContext();

    const getDatabricksAdapter = (conversationId: ConversationId | string): DatabricksDataAdapter | null => {
        try {
            const session = options.sessions().for(conversationId);
            const status = session.status();
            if (status.state === "live" && status.record.provider === "databricks") {
                return (session as unknown as { adapter: DatabricksDataAdapter }).adapter ?? null;
            }
        } catch {
            // Ignore session resolution failure
        }
        return null;
    };

    const mlflowLogEvalTool = defineTool({
        name: "mlflow_log_eval",
        description: "Logs evaluation metrics, statistical scores, and metadata to Databricks MLflow tracking server.",
        parameters: Type.Object({
            experimentName: Type.String({ description: "Databricks MLflow experiment name, e.g. /Shared/dataclaw-evals" }),
            evalName: Type.String({ description: "Evaluation suite name, e.g. growth-funnel-power" }),
            scores: Type.Array(
                Type.Object({
                    metricName: Type.String({ description: "Metric name, e.g. statistical_power, srm_rate" }),
                    score: Type.Number({ description: "Numeric score or metric value" }),
                    sampleSize: Type.Optional(Type.Number()),
                    rationale: Type.Optional(Type.String()),
                }),
                { description: "List of evaluation metrics to record" },
            ),
            gitCommit: Type.Optional(Type.String({ description: "Current git commit SHA" })),
            modelId: Type.Optional(Type.String({ description: "Model used for evaluation" })),
        }),
        replay: "safe",
        execute: async (args) => {
            const ctx = getContext();
            const host = ctx.host || process.env.DATABRICKS_HOST;
            const token = ctx.token || process.env.DATABRICKS_TOKEN;

            if (!host || !token) {
                return textResult("Databricks MLflow is not available: DATABRICKS_HOST and DATABRICKS_TOKEN must be configured.");
            }

            const client = new DatabricksMlflowClient({ host, token });
            try {
                const report = await client.logEvalResults(
                    args.experimentName,
                    args.evalName,
                    args.scores,
                    {
                        gitCommit: args.gitCommit,
                        agentModel: args.modelId,
                    },
                );

                return textResult(
                    `Successfully logged eval "${args.evalName}" to Databricks MLflow.\n` +
                    `- Experiment ID: ${report.experimentId}\n` +
                    `- Run ID: ${report.runId}\n` +
                    `- Metrics logged: ${report.scores.length}\n` +
                    `View in Databricks MLflow UI at: ${host}/ml/experiments/${report.experimentId}/runs/${report.runId}`,
                );
            } catch (err) {
                return textResult(`Failed to log eval to MLflow: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });

    const databricksAiQueryTool = defineTool({
        name: "databricks_ai_query",
        description: "Executes foundation model inference inside Databricks Lakehouse SQL using Unity Catalog system.ai.ai_query().",
        parameters: Type.Object({
            endpoint: Type.String({ description: "Databricks serving endpoint, e.g. databricks-meta-llama-3-3-70b-instruct" }),
            prompt: Type.String({ description: "Prompt or text to send to the serving endpoint" }),
        }),
        replay: "safe",
        execute: async (args, api) => {
            const adapter = getDatabricksAdapter(api.conversationId);
            if (!adapter) {
                return textResult("databricks_ai_query requires an active Databricks data source connection.");
            }

            const client = new DatabricksSystemAiClient(adapter);
            try {
                const response = await client.aiQuery({
                    endpoint: args.endpoint,
                    prompt: args.prompt,
                });
                return textResult(response);
            } catch (err) {
                return textResult(`ai_query failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });

    const databricksAiFunctionTool = defineTool({
        name: "databricks_ai_function",
        description: "Invokes Unity Catalog native AI functions: ai_summarize, ai_classify, ai_extract, ai_similarity, ai_mask, or ai_analyze_sentiment.",
        parameters: Type.Object({
            functionName: Type.Union([
                Type.Literal("ai_summarize"),
                Type.Literal("ai_classify"),
                Type.Literal("ai_extract"),
                Type.Literal("ai_similarity"),
                Type.Literal("ai_mask"),
                Type.Literal("ai_analyze_sentiment"),
            ]),
            text: Type.String({ description: "Primary text input" }),
            secondaryText: Type.Optional(Type.String({ description: "Secondary text for ai_similarity" })),
            optionsList: Type.Optional(Type.Array(Type.String(), { description: "Categories for ai_classify, labels for ai_extract, or entities for ai_mask" })),
            maxWords: Type.Optional(Type.Number({ description: "Max words for ai_summarize" })),
        }),
        replay: "safe",
        execute: async (args, api) => {
            const adapter = getDatabricksAdapter(api.conversationId);
            if (!adapter) {
                return textResult("databricks_ai_function requires an active Databricks connection.");
            }

            const client = new DatabricksSystemAiClient(adapter);
            try {
                switch (args.functionName) {
                    case "ai_summarize": {
                        const summary = await client.aiSummarize(args.text, args.maxWords);
                        return textResult(summary);
                    }
                    case "ai_classify": {
                        const category = await client.aiClassify({
                            text: args.text,
                            categories: args.optionsList ?? [],
                        });
                        return textResult(category);
                    }
                    case "ai_extract": {
                        const extracted = await client.aiExtract({
                            text: args.text,
                            labels: args.optionsList ?? [],
                        });
                        return textResult(JSON.stringify(extracted, null, 2));
                    }
                    case "ai_similarity": {
                        const similarity = await client.aiSimilarity(args.text, args.secondaryText ?? "");
                        return textResult(String(similarity));
                    }
                    case "ai_mask": {
                        const masked = await client.aiMask({
                            text: args.text,
                            entities: args.optionsList ?? [],
                        });
                        return textResult(masked);
                    }
                    case "ai_analyze_sentiment": {
                        const sentiment = await client.aiAnalyzeSentiment(args.text);
                        return textResult(sentiment);
                    }
                }
            } catch (err) {
                return textResult(`databricks_ai_function (${args.functionName}) failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });

    const listDatabricksConnectionsTool = defineTool({
        name: "list_databricks_connections",
        description: "Lists all Unity Catalog Lakehouse Federation connections (e.g. PostgreSQL, Snowflake, BigQuery) available in the Databricks workspace.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async () => {
            const ctx = getContext();
            const host = ctx.host || process.env.DATABRICKS_HOST;
            const token = ctx.token || process.env.DATABRICKS_TOKEN;

            if (!host || !token) {
                return textResult("Databricks Connections API is not available: DATABRICKS_HOST and DATABRICKS_TOKEN must be configured.");
            }

            const client = new DatabricksConnectionsClient({ host, token });
            try {
                const conns = await client.listConnections();
                if (conns.length === 0) {
                    return textResult("No Lakehouse Federation connections found in this workspace.");
                }

                const lines = conns.map((c) =>
                    `- **${c.name}** (${c.connectionType})${c.host ? ` at ${c.host}` : ""}${c.comment ? `: ${c.comment}` : ""}`
                );
                return textResult(`### Available Databricks Lakehouse Connections:\n${lines.join("\n")}`);
            } catch (err) {
                return textResult(`Failed to list connections: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });

    const databricksGenieAskTool = defineTool({
        name: "databricks_genie_ask",
        description: "Consults a curated Databricks AI/BI Genie Space to answer analytical questions, retrieve certified SQL, or verify business KPIs.",
        parameters: Type.Object({
            spaceId: Type.String({ description: "Databricks Genie Space ID" }),
            question: Type.String({ description: "Question to ask the curated Genie Space" }),
        }),
        replay: "safe",
        execute: async (args) => {
            const ctx = getContext();
            const host = ctx.host || process.env.DATABRICKS_HOST;
            const token = ctx.token || process.env.DATABRICKS_TOKEN;

            if (!host || !token) {
                return textResult("Databricks Genie is not available: DATABRICKS_HOST and DATABRICKS_TOKEN must be configured.");
            }

            const client = new DatabricksGenieClient({ host, token });
            try {
                const result = await client.ask(parseGenieSpaceId(args.spaceId), args.question);
                let responseText = `### Genie Space Response (${result.status}):\n${result.content || "No direct answer text."}`;
                if (result.sqlQuery) {
                    responseText += "\n\n```sql\n-- " + (result.queryDescription || "Certified Genie SQL") + "\n" + result.sqlQuery + "\n```";
                }
                if (result.error) {
                    responseText += `\n\n**Error:** ${result.error}`;
                }
                return textResult(responseText);
            } catch (err) {
                return textResult(`Genie query failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });

    const databricksGenieListTool = defineTool({
        name: "databricks_genie_list",
        description: "Lists available Databricks AI/BI Genie Spaces in the workspace.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async () => {
            const ctx = getContext();
            const host = ctx.host || process.env.DATABRICKS_HOST;
            const token = ctx.token || process.env.DATABRICKS_TOKEN;

            if (!host || !token) {
                return textResult("Databricks Genie is not available: DATABRICKS_HOST and DATABRICKS_TOKEN must be configured.");
            }

            const client = new DatabricksGenieClient({ host, token });
            try {
                const spaces = await client.listSpaces();
                if (spaces.length === 0) {
                    return textResult("No AI/BI Genie Spaces found in this workspace.");
                }

                const lines = spaces.map((s) =>
                    `- **${s.title}** (ID: \`${s.spaceId}\`)${s.description ? `: ${s.description}` : ""}`
                );
                return textResult(`### Available Databricks AI/BI Genie Spaces:\n${lines.join("\n")}`);
            } catch (err) {
                return textResult(`Failed to list Genie spaces: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
    });

    return {
        mlflowLogEvalTool,
        databricksAiQueryTool,
        databricksAiFunctionTool,
        listDatabricksConnectionsTool,
        databricksGenieAskTool,
        databricksGenieListTool,
        all: [
            mlflowLogEvalTool,
            databricksAiQueryTool,
            databricksAiFunctionTool,
            listDatabricksConnectionsTool,
            databricksGenieAskTool,
            databricksGenieListTool,
        ],
    };
}
