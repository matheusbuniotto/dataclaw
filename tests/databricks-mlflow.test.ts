import { describe, expect, test } from "bun:test";
import { DatabricksMlflowClient, DatabricksMlflowError } from "../src/mcp/databricks-mlflow";
import { parseMlflowExperimentId, parseMlflowRunId } from "../src/types/brands";

describe("DatabricksMlflowClient", () => {
    test("getOrCreateExperiment returns existing experiment or creates new one", async () => {
        const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
        const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

            if (url.includes("/experiments/get-by-name")) {
                if (url.includes("existing-experiment")) {
                    return new Response(JSON.stringify({
                        experiment: {
                            experiment_id: "exp-123",
                            name: "existing-experiment",
                            lifecycle_stage: "active",
                        },
                    }));
                }
                return new Response(JSON.stringify({ error_code: "RESOURCE_DOES_NOT_EXIST", message: "Not found" }), { status: 404 });
            }

            if (url.includes("/experiments/create")) {
                return new Response(JSON.stringify({ experiment_id: "exp-999" }));
            }

            return new Response("{}", { status: 200 });
        };

        const client = new DatabricksMlflowClient({
            host: "https://dbc-test.cloud.databricks.com",
            token: "dapi-test-token",
            fetchFn: mockFetch,
        });

        const existingId = await client.getOrCreateExperiment("existing-experiment");
        expect(existingId).toBe(parseMlflowExperimentId("exp-123"));

        const newId = await client.getOrCreateExperiment("brand-new-experiment");
        expect(newId).toBe(parseMlflowExperimentId("exp-999"));
        expect(requests.some((r) => r.url.includes("/experiments/create"))).toBe(true);
    });

    test("createRun, logBatch and logEvalResults succeed", async () => {
        const calls: string[] = [];
        const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            calls.push(url);

            if (url.includes("/experiments/get-by-name")) {
                return new Response(JSON.stringify({
                    experiment: {
                        experiment_id: "exp-eval",
                        name: "dataclaw-evals",
                        lifecycle_stage: "active",
                    },
                }));
            }

            if (url.includes("/runs/create")) {
                return new Response(JSON.stringify({
                    run: {
                        info: {
                            run_id: "run-abc-123",
                            experiment_id: "exp-eval",
                            status: "RUNNING",
                            start_time: 1700000000,
                        },
                    },
                }));
            }

            if (url.includes("/runs/log-batch") || url.includes("/runs/update")) {
                return new Response(JSON.stringify({}));
            }

            return new Response("{}", { status: 200 });
        };

        const client = new DatabricksMlflowClient({
            host: "https://dbc-test.cloud.databricks.com",
            token: "dapi-test-token",
            fetchFn: mockFetch,
        });

        const report = await client.logEvalResults(
            "dataclaw-evals",
            "growth-funnel-power-eval",
            [
                { metricName: "statistical_power", score: 0.88, sampleSize: 1200 },
                { metricName: "srm_detection_rate", score: 0.99 },
                { metricName: "decision_quality", score: 0.95 },
            ],
            { gitCommit: "7e3ef0c", agentModel: "llama-3.3-70b", durationMs: 450 },
        );

        expect(report.runId).toBe(parseMlflowRunId("run-abc-123"));
        expect(report.scores.length).toBe(3);
        expect(calls.some((c) => c.includes("/runs/create"))).toBe(true);
        expect(calls.some((c) => c.includes("/runs/log-batch"))).toBe(true);
        expect(calls.some((c) => c.includes("/runs/update"))).toBe(true);
    });
});
