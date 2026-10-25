import type { MlflowExperimentId, MlflowRunId } from "../types/brands";
import { parseMlflowExperimentId, parseMlflowRunId } from "../types/brands";
import { engineLogger } from "../observability/logger";

export interface MlflowMetric {
    readonly key: string;
    readonly value: number;
    readonly timestamp?: number;
    readonly step?: number;
}

export interface MlflowParam {
    readonly key: string;
    readonly value: string;
}

export interface MlflowTag {
    readonly key: string;
    readonly value: string;
}

export interface MlflowExperiment {
    readonly experimentId: MlflowExperimentId;
    readonly name: string;
    readonly artifactLocation?: string;
    readonly lifecycleStage: string;
}

export interface MlflowRun {
    readonly runId: MlflowRunId;
    readonly experimentId: MlflowExperimentId;
    readonly status: "RUNNING" | "SCHEDULED" | "FINISHED" | "FAILED" | "KILLED";
    readonly startTime: number;
    readonly endTime?: number;
}

export interface MlflowEvalScore {
    readonly metricName: string;
    readonly score: number;
    readonly sampleSize?: number;
    readonly confidenceInterval?: [number, number];
    readonly pValue?: number;
    readonly rationale?: string;
}

export interface MlflowEvalReport {
    readonly runId: MlflowRunId;
    readonly experimentId: MlflowExperimentId;
    readonly evalDataset: string;
    readonly scores: readonly MlflowEvalScore[];
    readonly durationMs: number;
    readonly loggedAt: number;
}

export interface DatabricksMlflowOptions {
    readonly host: string;
    readonly token: string;
    readonly fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export class DatabricksMlflowError extends Error {
    readonly statusCode?: number;
    readonly errorCode?: string;

    constructor(message: string, statusCode?: number, errorCode?: string) {
        super(message);
        this.name = "DatabricksMlflowError";
        this.statusCode = statusCode;
        this.errorCode = errorCode;
    }
}

export class DatabricksMlflowClient {
    private readonly host: string;
    private readonly token: string;
    private readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

    constructor(options: DatabricksMlflowOptions) {
        this.host = options.host.replace(/\/$/, "");
        this.token = options.token;
        this.fetch = options.fetchFn ?? globalThis.fetch;
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.host}${endpoint}`;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string> | undefined),
        };

        const response = await this.fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            let errorBody = "";
            let errorCode: string | undefined;
            try {
                const json = (await response.json()) as { error_code?: string; message?: string; error?: string };
                errorCode = json.error_code;
                errorBody = json.message || json.error || JSON.stringify(json);
            } catch {
                errorBody = await response.text();
            }
            throw new DatabricksMlflowError(
                `Databricks MLflow request failed (${response.status} ${response.statusText}): ${errorBody}`,
                response.status,
                errorCode,
            );
        }

        return (await response.json()) as T;
    }

    async getExperimentByName(name: string): Promise<MlflowExperiment | null> {
        try {
            const query = new URLSearchParams({ experiment_name: name }).toString();
            const res = await this.request<{
                experiment?: {
                    experiment_id: string;
                    name: string;
                    artifact_location?: string;
                    lifecycle_stage: string;
                };
            }>(`/api/2.0/mlflow/experiments/get-by-name?${query}`, { method: "GET" });

            if (!res.experiment) return null;

            return {
                experimentId: parseMlflowExperimentId(res.experiment.experiment_id),
                name: res.experiment.name,
                artifactLocation: res.experiment.artifact_location,
                lifecycleStage: res.experiment.lifecycle_stage,
            };
        } catch (err) {
            if (err instanceof DatabricksMlflowError && (err.statusCode === 404 || err.errorCode === "RESOURCE_DOES_NOT_EXIST")) {
                return null;
            }
            throw err;
        }
    }

    async createExperiment(name: string): Promise<MlflowExperimentId> {
        const res = await this.request<{ experiment_id: string }>("/api/2.0/mlflow/experiments/create", {
            method: "POST",
            body: JSON.stringify({ name }),
        });
        return parseMlflowExperimentId(res.experiment_id);
    }

    async getOrCreateExperiment(name: string): Promise<MlflowExperimentId> {
        const existing = await this.getExperimentByName(name);
        if (existing) {
            return existing.experimentId;
        }
        try {
            return await this.createExperiment(name);
        } catch (err) {
            if (err instanceof DatabricksMlflowError && err.errorCode === "RESOURCE_ALREADY_EXISTS") {
                const retry = await this.getExperimentByName(name);
                if (retry) return retry.experimentId;
            }
            throw err;
        }
    }

    async createRun(experimentId: MlflowExperimentId, tags: Record<string, string> = {}): Promise<MlflowRun> {
        const tagList: MlflowTag[] = Object.entries(tags).map(([key, value]) => ({ key, value }));
        const startTime = Date.now();
        const res = await this.request<{
            run: {
                info: {
                    run_id: string;
                    experiment_id: string;
                    status: string;
                    start_time: number;
                    end_time?: number;
                };
            };
        }>("/api/2.0/mlflow/runs/create", {
            method: "POST",
            body: JSON.stringify({
                experiment_id: experimentId,
                start_time: startTime,
                tags: tagList,
            }),
        });

        const info = res.run.info;
        return {
            runId: parseMlflowRunId(info.run_id),
            experimentId: parseMlflowExperimentId(info.experiment_id),
            status: "RUNNING",
            startTime: info.start_time,
            endTime: info.end_time,
        };
    }

    async logMetric(runId: MlflowRunId, metric: MlflowMetric): Promise<void> {
        await this.request("/api/2.0/mlflow/runs/log-metric", {
            method: "POST",
            body: JSON.stringify({
                run_id: runId,
                key: metric.key,
                value: metric.value,
                timestamp: metric.timestamp ?? Date.now(),
                step: metric.step ?? 0,
            }),
        });
    }

    async logBatch(
        runId: MlflowRunId,
        params: {
            metrics?: readonly MlflowMetric[];
            params?: readonly MlflowParam[];
            tags?: readonly MlflowTag[];
        },
    ): Promise<void> {
        const body: Record<string, unknown> = { run_id: runId };
        if (params.metrics && params.metrics.length > 0) {
            body.metrics = params.metrics.map((m) => ({
                key: m.key,
                value: m.value,
                timestamp: m.timestamp ?? Date.now(),
                step: m.step ?? 0,
            }));
        }
        if (params.params && params.params.length > 0) {
            body.params = params.params;
        }
        if (params.tags && params.tags.length > 0) {
            body.tags = params.tags;
        }

        await this.request("/api/2.0/mlflow/runs/log-batch", {
            method: "POST",
            body: JSON.stringify(body),
        });
    }

    async updateRunStatus(runId: MlflowRunId, status: "FINISHED" | "FAILED" | "KILLED"): Promise<void> {
        await this.request("/api/2.0/mlflow/runs/update", {
            method: "POST",
            body: JSON.stringify({
                run_id: runId,
                status,
                end_time: Date.now(),
            }),
        });
    }

    async logEvalResults(
        experimentName: string,
        evalName: string,
        scores: readonly MlflowEvalScore[],
        metadata: {
            gitCommit?: string;
            agentModel?: string;
            durationMs?: number;
            [key: string]: string | number | undefined;
        } = {},
    ): Promise<MlflowEvalReport> {
        const experimentId = await this.getOrCreateExperiment(experimentName);
        const tags: Record<string, string> = {
            "dataclaw.eval": evalName,
            "dataclaw.source": "dataclaw-eval-suite",
        };
        if (metadata.gitCommit) tags["git.commit"] = metadata.gitCommit;
        if (metadata.agentModel) tags["agent.model"] = metadata.agentModel;

        const run = await this.createRun(experimentId, tags);

        const metricsToLog: MlflowMetric[] = scores.map((s, idx) => ({
            key: s.metricName,
            value: s.score,
            step: idx,
            timestamp: Date.now(),
        }));

        const paramsToLog: MlflowParam[] = Object.entries(metadata)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => ({ key: k, value: String(v) }));

        await this.logBatch(run.runId, {
            metrics: metricsToLog,
            params: paramsToLog,
        });

        await this.updateRunStatus(run.runId, "FINISHED");

        engineLogger.info("MLflow", "Logged evaluation report to Databricks MLflow", {
            experimentId,
            runId: run.runId,
            evalName,
            metricsCount: scores.length,
        });

        return {
            runId: run.runId,
            experimentId,
            evalDataset: evalName,
            scores,
            durationMs: metadata.durationMs ?? 0,
            loggedAt: Date.now(),
        };
    }
}
