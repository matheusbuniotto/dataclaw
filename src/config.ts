import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { envApiKeyAuth } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { fauxProvider, fauxAssistantMessage, type FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
import { resolveDatabricksConfig } from "./mcp/databricks-config";
import {
    loadPiCredentialStore,
    providerConfigured,
    readPiModelSelection,
    type PiConfigOptions,
} from "./pi-config";

export interface ResolvedModelConfig {
    provider: string;
    modelId: string;
}

export interface ModelRegistryOptions extends PiConfigOptions {
    fauxHandle?: FauxProviderHandle;
}

export interface CustomModelConfig {
    baseUrl: string;
    apiKey?: string;
    modelId?: string;
    name?: string;
}

export interface DatabricksModelConfig {
    host: string;
    token?: string;
    baseUrl: string;
    defaultModelId?: string;
}

export const DATABRICKS_FOUNDATION_MODELS = [
    "databricks-meta-llama-3-3-70b-instruct",
    "databricks-meta-llama-3-1-405b-instruct",
    "databricks-meta-llama-3-1-70b-instruct",
    "databricks-meta-llama-3-1-8b-instruct",
    "databricks-dbrx-instruct",
    "databricks-mixtral-8x7b-instruct",
    "databricks-bge-large-en",
] as const;

export const DATABRICKS_GATEWAY_ROUTES = [
    { id: "openai-gpt-4o", name: "OpenAI GPT-4o", description: "Databricks AI Gateway route to GPT-4o" },
    { id: "openai-gpt-4o-mini", name: "OpenAI GPT-4o mini", description: "Databricks AI Gateway route to GPT-4o mini" },
    { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", description: "Databricks AI Gateway route to Claude 3.7 Sonnet" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", description: "Databricks AI Gateway route to Claude 3.5 Sonnet" },
    { id: "mistral-large", name: "Mistral Large", description: "Databricks AI Gateway route to Mistral Large" },
    { id: "meta-llama-3-3-70b-instruct", name: "Meta Llama 3.3 70B", description: "Databricks AI Gateway route to Llama 3.3" },
] as const;

export const OPENROUTER_RECOMMENDED_MODELS = [
    { id: "openai/gpt-6-luna", name: "OpenAI GPT-6 Luna", reasoning: true, description: "Next-generation multimodal reasoning & synthesis" },
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", reasoning: true, description: "Hybrid reasoning with adjustable thinking" },
    { id: "anthropic/claude-3.7-sonnet:thinking", name: "Claude 3.7 Sonnet (Thinking)", reasoning: true, description: "Extended deliberate reasoning" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", reasoning: false, description: "Fast analysis and coding" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1", reasoning: true, description: "Open weights reasoning model" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3", reasoning: false, description: "Cost-effective fast reasoning" },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Meta Llama 3.3 70B Instruct", reasoning: false, description: "Open source standard" },
    { id: "openai/gpt-4o", name: "OpenAI GPT-4o", reasoning: false, description: "Omni multimodal model" },
    { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o mini", reasoning: false, description: "Fast lightweight model" },
    { id: "openai/o3-mini", name: "OpenAI o3-mini", reasoning: true, description: "STEM and coding reasoning" },
    { id: "google/gemini-2.5-pro", name: "Google Gemini 2.5 Pro", reasoning: true, description: "Large context reasoning" },
    { id: "google/gemini-2.0-flash-001", name: "Google Gemini 2.0 Flash", reasoning: false, description: "Sub-second multimodal model" },
    { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", reasoning: false, description: "Code intelligence specialist" },
    { id: "mistralai/mistral-large-2407", name: "Mistral Large 2", reasoning: false, description: "Enterprise multilingual reasoning" },
] as const;

export interface ModelOptionInfo {
    id: string;
    name: string;
    provider: string;
    category: "databricks_foundation" | "databricks_gateway" | "openrouter" | "custom" | "other";
    reasoning?: boolean;
    description?: string;
}

export interface AvailableAiModelsResponse {
    current: ResolvedModelConfig;
    fallback?: {
        model: ResolvedModelConfig;
        available: boolean;
        reason: string;
    };
    categories: {
        id: string;
        name: string;
        description: string;
        models: ModelOptionInfo[];
    }[];
}

const REAL_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "opencode-go"] as const;

/**
 * Normalizes an OpenAI-compatible base URL.
 * Strips trailing slashes and ensures standard protocol without trailing `/chat/completions`.
 */
export function normalizeBaseUrl(url: string): string {
    let clean = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(clean)) {
        clean = `https://${clean}`;
    }
    if (clean.endsWith("/chat/completions")) {
        clean = clean.slice(0, -"/chat/completions".length);
    }
    return clean;
}

function normalizeHost(host: string): string {
    const trimmed = host.trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Resolves configuration for a custom OpenAI-compatible model endpoint.
 * Suitable for Databricks DAB secrets (`{{secrets/<scope>/<key>}}`), vLLM, LiteLLM,
 * Azure OpenAI, or private corporate model gateways.
 */
export function resolveCustomModelConfig(): CustomModelConfig | undefined {
    const rawUrl =
        process.env.CUSTOM_MODEL_BASE_URL?.trim() ||
        process.env.DATABRICKS_MODEL_BASE_URL?.trim() ||
        process.env.MODEL_BASE_URL?.trim();
    const apiKey =
        process.env.CUSTOM_MODEL_API_KEY?.trim() ||
        process.env.DATABRICKS_MODEL_API_KEY?.trim() ||
        process.env.MODEL_API_KEY?.trim();
    const modelId =
        process.env.CUSTOM_MODEL_ID?.trim() ||
        process.env.MODEL_ID?.trim() ||
        "custom-model";
    const name = process.env.CUSTOM_MODEL_NAME?.trim() || "Custom Model";

    const hasCustomIndicator = Boolean(
        rawUrl ||
        apiKey ||
        process.env.CUSTOM_MODEL_ID?.trim() ||
        process.env.CUSTOM_MODEL_NAME?.trim(),
    );

    if (!hasCustomIndicator) return undefined;

    const baseUrl = normalizeBaseUrl(rawUrl || process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1");
    return {
        baseUrl,
        apiKey: apiKey || process.env.OPENAI_API_KEY?.trim(),
        modelId,
        name,
    };
}

export function isCustomModelConfigured(): boolean {
    return resolveCustomModelConfig() !== undefined;
}

/**
 * Resolves Databricks Model Serving configuration.
 * In Databricks Apps, DATABRICKS_HOST and DATABRICKS_TOKEN are injected into the container environment.
 * Databricks exposes standard OpenAI-compatible endpoints at `${host}/serving-endpoints`.
 */
export function resolveDatabricksModelConfig(): DatabricksModelConfig | undefined {
    const hostEnv = process.env.DATABRICKS_HOST?.trim();
    const tokenEnv = process.env.DATABRICKS_TOKEN?.trim() || process.env.DATABRICKS_MODEL_API_KEY?.trim();
    const modelIdEnv = process.env.DATABRICKS_MODEL_ID?.trim();
    const isDatabricksApp = Boolean(process.env.DATABRICKS_APP_PORT || process.env.DATABRICKS_APP_NAME);
    const explicitlyRequested = process.env.DEFAULT_MODEL_PROVIDER === "databricks" || Boolean(modelIdEnv);

    if (hostEnv || isDatabricksApp || explicitlyRequested) {
        let host = hostEnv;
        let token = tokenEnv;

        if (!host || !token) {
            try {
                const mcpCfg = resolveDatabricksConfig();
                host = host || mcpCfg.host;
                token = token || mcpCfg.token;
            } catch {
                // Ignore if not resolvable from local profiles
            }
        }

        if (host) {
            const normalizedHost = normalizeHost(host);
            const baseUrl = process.env.DATABRICKS_SERVING_BASE_URL?.trim() || `${normalizedHost}/serving-endpoints`;
            const defaultModelId = modelIdEnv || "databricks-meta-llama-3-3-70b-instruct";
            return {
                host: normalizedHost,
                token,
                baseUrl,
                defaultModelId,
            };
        }
    }

    return undefined;
}

export function isDatabricksModelConfigured(): boolean {
    const cfg = resolveDatabricksModelConfig();
    return Boolean(cfg && cfg.host);
}

/**
 * Creates a provider wrapping a custom OpenAI-compatible endpoint.
 */
export function createCustomModelProvider(config?: CustomModelConfig) {
    const resolved = config ?? resolveCustomModelConfig() ?? {
        baseUrl: "https://api.openai.com/v1",
        modelId: "custom-model",
        name: "Custom Model",
    };

    const modelId = resolved.modelId || "custom-model";
    const baseUrl = resolved.baseUrl;

    const modelIds = Array.from(new Set([
        modelId,
        "custom-model",
        "llama-3.3-70b-instruct",
        "gpt-4o",
        "gpt-4o-mini",
    ]));

    const models = modelIds.map((id) => ({
        id,
        name: id === modelId ? (resolved.name || id) : id,
        api: "openai-completions" as const,
        provider: "custom",
        baseUrl,
        reasoning: false,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
        type: "chat" as const,
    }));

    return createProvider({
        id: "custom",
        name: resolved.name || "Custom Model",
        baseUrl,
        auth: {
            apiKey: envApiKeyAuth("Custom Model API Key", [
                "CUSTOM_MODEL_API_KEY",
                "DATABRICKS_MODEL_API_KEY",
                "OPENAI_API_KEY",
                "MODEL_API_KEY",
            ]),
        },
        models,
        api: openAICompletionsApi(),
    });
}

export function parseConfiguredGatewayEndpoints(): string[] {
    const raw = process.env.DATABRICKS_GATEWAY_ENDPOINTS?.trim();
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseConfiguredOpenRouterModels(): string[] {
    const raw = (
        process.env.OPENROUTER_MODELS?.trim() ||
        process.env.AI_MODELS?.trim() ||
        process.env.RECOMMENDED_MODELS?.trim()
    );
    if (!raw) return [];

    if (raw.startsWith("[") && raw.endsWith("]")) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => (typeof item === "string" ? item.trim() : (item?.id || item?.name)?.trim()))
                    .filter((x): x is string => Boolean(x));
            }
        } catch {
            // fall through
        }
    }

    return raw
        .split(",")
        .map((s) => {
            const trimmed = s.trim();
            if (!trimmed) return "";
            const colon = trimmed.indexOf(":");
            if (colon > 0 && !trimmed.slice(colon).includes("/") && !trimmed.startsWith("http")) {
                return trimmed.slice(0, colon).trim();
            }
            return trimmed;
        })
        .filter(Boolean);
}

export interface RemoteModelFetchOptions {
    baseUrl?: string;
    apiKey?: string;
    provider?: string;
}

/**
 * Dynamically queries an OpenAI-compatible router endpoint (such as OpenRouter, LiteLLM,
 * vLLM, or Ollama) to discover and retrieve the live catalog of available models.
 */
export async function fetchRemoteRouterModels(
    options: RemoteModelFetchOptions = {},
): Promise<ModelOptionInfo[]> {
    const rawUrl = options.baseUrl?.trim() || process.env.OPENROUTER_BASE_URL?.trim();
    const apiKey =
        options.apiKey?.trim() ||
        process.env.OPENROUTER_API_KEY?.trim() ||
        process.env.CUSTOM_MODEL_API_KEY?.trim() ||
        process.env.MODEL_API_KEY?.trim();

    if (!rawUrl && !apiKey) {
        return [];
    }

    const resolvedUrl = rawUrl || "https://openrouter.ai/api/v1";
    const normalized = normalizeBaseUrl(resolvedUrl);
    const modelsUrl = normalized.endsWith("/models") ? normalized : `${normalized}/models`;

    const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "DataClaw/1.0",
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch(modelsUrl, {
            headers,
            signal: AbortSignal.timeout(4000),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as Record<string, unknown>;
        const list = Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.models)
                ? data.models
                : [];

        const provider = options.provider || (rawUrl.includes("openrouter") ? "openrouter" : "custom");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const models: ModelOptionInfo[] = list
            .map((item: any): ModelOptionInfo | null => {
                const id = typeof item === "string" ? item : (item?.id || item?.name);
                if (!id || typeof id !== "string") return null;
                const name = typeof item?.name === "string" && item.name ? item.name : id;
                const description = typeof item?.description === "string" ? item.description : undefined;
                const reasoning = Boolean(
                    item?.reasoning ||
                    id.includes("r1") ||
                    id.includes("thinking") ||
                    id.includes("o1") ||
                    id.includes("o3") ||
                    id.includes("luna"),
                );
                return {
                    id: provider === "openrouter" && !id.startsWith("openrouter/") ? `openrouter/${id}` : id,
                    name,
                    provider,
                    category: (provider === "openrouter" ? "openrouter" : "custom") as ModelOptionInfo["category"],
                    reasoning,
                    description,
                };
            })
            .filter((m): m is ModelOptionInfo => m !== null);

        return models;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Remote Models] Failed to query ${modelsUrl}: ${msg}`);
        return [];
    }
}

function formatDatabricksModelName(id: string, provider: string): string {
    if (provider === "gateway") {
        const found = DATABRICKS_GATEWAY_ROUTES.find((r) => r.id === id);
        return found ? found.name : `Gateway: ${id}`;
    }
    return id.replace(/^databricks-/, "").replace(/-/g, " ");
}

/**
 * Creates a provider for Databricks AI-native Model Serving or Databricks AI Gateway routes.
 * Interacts with Databricks Foundation Model APIs (such as Meta Llama 3.3 70B Instruct or DBRX)
 * and proxied Gateway endpoints using the standard OpenAI-compatible `/serving-endpoints` interface.
 */
export function createDatabricksModelProvider(
    config?: DatabricksModelConfig,
    providerId: "databricks" | "gateway" = "databricks",
) {
    const resolved = config ?? resolveDatabricksModelConfig();
    const baseUrl = resolved?.baseUrl ?? "https://dbc-cloud.databricks.com/serving-endpoints";
    const defaultModelId = resolved?.defaultModelId ?? "databricks-meta-llama-3-3-70b-instruct";
    const gatewayEndpoints = parseConfiguredGatewayEndpoints();

    const allModelIds = Array.from(new Set([
        defaultModelId,
        ...DATABRICKS_FOUNDATION_MODELS,
        ...DATABRICKS_GATEWAY_ROUTES.map((r) => r.id),
        ...gatewayEndpoints,
    ]));

    const models = allModelIds.map((id) => ({
        id,
        name: formatDatabricksModelName(id, providerId),
        api: "openai-completions" as const,
        provider: providerId,
        baseUrl,
        reasoning: id.includes("reasoning") || id.includes("thinking") || id.includes("r1") || id.includes("o3"),
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
        type: "chat" as const,
    }));

    return createProvider({
        id: providerId,
        name: providerId === "gateway" ? "Databricks AI Gateway" : "Databricks Model Serving",
        baseUrl,
        auth: {
            apiKey: {
                name: providerId === "gateway" ? "Databricks AI Gateway Token" : "Databricks Token",
                resolve: async ({ ctx, credential, signal }) => {
                    signal.throwIfAborted();
                    let token =
                        credential?.key ||
                        (await ctx.env("DATABRICKS_TOKEN")) ||
                        (await ctx.env("DATABRICKS_MODEL_API_KEY"));
                    let source = credential?.key ? "stored credential" : "DATABRICKS_TOKEN";

                    if (!token && resolved?.token) {
                        token = resolved.token;
                        source = "Databricks config/CLI";
                    }

                    if (!token) return undefined;
                    return {
                        auth: { apiKey: token },
                        source,
                    };
                },
            },
        },
        models,
        api: openAICompletionsApi(),
    });
}

export function setupModelsRegistry(options: ModelRegistryOptions = {}) {
    const { store, providerIds } = loadPiCredentialStore(options.authPath);
    const models = createModels({ credentials: store });
    const configured = (providerId: string) => providerConfigured(providerId, providerIds);

    const customConfig = resolveCustomModelConfig();
    if (customConfig || configured("custom")) {
        models.setProvider(createCustomModelProvider(customConfig));
    }

    const databricksConfig = resolveDatabricksModelConfig();
    if (databricksConfig || configured("databricks") || configured("gateway")) {
        models.setProvider(createDatabricksModelProvider(databricksConfig, "databricks"));
        models.setProvider(createDatabricksModelProvider(databricksConfig, "gateway"));
    }

    if (configured("openai")) models.setProvider(openaiProvider());
    if (configured("anthropic")) models.setProvider(anthropicProvider());
    if (configured("google")) models.setProvider(googleProvider());
    if (configured("openrouter")) {
        const rawOpenRouter = openrouterProvider();
        const origGetModels = rawOpenRouter.getModels.bind(rawOpenRouter);
        const configuredCustom = parseConfiguredOpenRouterModels();
        const extraModelIds = Array.from(new Set([
            ...OPENROUTER_RECOMMENDED_MODELS.map((m) => m.id),
            ...configuredCustom,
        ]));
        const extraModels = extraModelIds.map((id) => {
            const rec = OPENROUTER_RECOMMENDED_MODELS.find((m) => m.id === id);
            const openRouterBaseUrl = rawOpenRouter.baseUrl || "https://openrouter.ai/api/v1";
            return {
                id,
                name: rec?.name || id,
                api: "openai-completions" as const,
                baseUrl: openRouterBaseUrl,
                provider: "openrouter",
                reasoning: rec?.reasoning ?? (id.includes("r1") || id.includes("o1") || id.includes("o3") || id.includes("thinking")),
                input: ["text" as const, "image" as const],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 8192,
                type: "chat" as const,
            };
        });
        const combinedGetModels = () => {
            const existing = origGetModels();
            const existingIds = new Set(existing.map((m) => m.id));
            return [...existing, ...extraModels.filter((m) => !existingIds.has(m.id))];
        };
        rawOpenRouter.getModels = combinedGetModels as typeof origGetModels;
        models.setProvider(rawOpenRouter);
    }
    if (configured("opencode-go")) models.setProvider(opencodeGoProvider());

    const hasAnyRealProvider =
        Boolean(customConfig) ||
        Boolean(databricksConfig) ||
        REAL_PROVIDERS.some(configured) ||
        configured("gateway");

    if (options.fauxHandle) {
        models.setProvider(options.fauxHandle.provider);
    } else if (!hasAnyRealProvider) {
        const fallbackFaux = fauxProvider({
            provider: "faux",
            models: [{ id: "faux-analyst", name: "Faux Analyst Model" }],
        });
        fallbackFaux.setResponses([
            fauxAssistantMessage("I am the Durable Analyst Agent. Ready to inspect data, test hypotheses, and auto-improve."),
        ]);
        models.setProvider(fallbackFaux.provider);
    }

    // Dynamic model synthesis for OpenRouter, Databricks, and Gateway
    const origGetModel = models.getModel.bind(models);
    const dynamicModelCache = new Map<string, unknown>();

    models.getModel = function (provider: string, id: string) {
        const found = origGetModel(provider, id);
        if (found) return found;

        const cacheKey = `${provider}:${id}`;
        if (dynamicModelCache.has(cacheKey)) {
            return dynamicModelCache.get(cacheKey) as ReturnType<typeof origGetModel>;
        }

        if (provider === "openrouter") {
            const dyn = {
                id,
                name: `OpenRouter: ${id}`,
                api: "openai-completions" as const,
                baseUrl: "https://openrouter.ai/api/v1",
                provider: "openrouter",
                reasoning: id.includes("r1") || id.includes("o1") || id.includes("o3") || id.includes("thinking"),
                input: ["text" as const],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 8192,
                type: "chat" as const,
            };
            dynamicModelCache.set(cacheKey, dyn);
            return dyn as unknown as ReturnType<typeof origGetModel>;
        }

        if (provider === "databricks" || provider === "gateway") {
            const baseUrl = databricksConfig?.baseUrl ?? "https://dbc-cloud.databricks.com/serving-endpoints";
            const dyn = {
                id,
                name: formatDatabricksModelName(id, provider),
                api: "openai-completions" as const,
                baseUrl,
                provider,
                reasoning: id.includes("reasoning") || id.includes("thinking") || id.includes("r1"),
                input: ["text" as const],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 4096,
                type: "chat" as const,
            };
            dynamicModelCache.set(cacheKey, dyn);
            return dyn as unknown as ReturnType<typeof origGetModel>;
        }

        return undefined;
    };

    // Resilient streaming fallback from external router models to Databricks AI Gateway
    const origStreamSimple = models.streamSimple.bind(models);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    models.streamSimple = function (primaryModel: any, context: any, streamOpts: any) {
        const isDatabricksNative = primaryModel?.provider === "databricks" || primaryModel?.provider === "gateway";
        const fallbackRef = resolveModelFallback(
            primaryModel ? { provider: primaryModel.provider, modelId: primaryModel.id } : undefined,
        );
        const fallbackModel = fallbackRef ? models.getModel(fallbackRef.provider, fallbackRef.modelId) : undefined;

        if (isDatabricksNative || !fallbackModel) {
            return origStreamSimple(primaryModel, context, streamOpts);
        }

        const targetFallbackModel = fallbackModel;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let activeStream: any = null;

        async function* resilientEvents() {
            let emittedContent = false;
            try {
                activeStream = origStreamSimple(primaryModel, context, streamOpts);
                for await (const event of activeStream) {
                    if (event.type === "error" && !emittedContent) {
                        throw new Error(event.error?.errorMessage || "Primary AI router error");
                    }
                    if (event.type !== "error" && event.type !== "done") {
                        emittedContent = true;
                    }
                    yield event;
                }
                const finalRes = await activeStream.result();
                if (finalRes?.stopReason === "error" && !emittedContent) {
                    throw new Error(finalRes.errorMessage || "Primary AI router stopped with error");
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[AI Fallback] ${primaryModel.provider}/${primaryModel.id} failed (${message}). Falling back to Databricks AI Gateway (${targetFallbackModel.provider}/${targetFallbackModel.id})...`);
                activeStream = origStreamSimple(targetFallbackModel, context, streamOpts);
                for await (const event of activeStream) {
                    yield event;
                }
            }
        }

        const generator = resilientEvents();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wrapper: any = {
            [Symbol.asyncIterator]() {
                return generator;
            },
            async result() {
                if (!activeStream) {
                    for await (const _ of this) { /* iterate */ }
                }
                return await activeStream.result();
            },
            get finalResultPromise() {
                return activeStream?.finalResultPromise;
            },
        };
        return wrapper;
    };

    return models;
}

export function getDefaultModelRef(options: PiConfigOptions = {}): ResolvedModelConfig {
    if (process.env.DEFAULT_MODEL_PROVIDER && process.env.DEFAULT_MODEL_ID) {
        return {
            provider: process.env.DEFAULT_MODEL_PROVIDER,
            modelId: process.env.DEFAULT_MODEL_ID,
        };
    }

    // 1. Custom model configured via DAB secrets or env (e.g. vLLM, private gateway, Azure)
    const customConfig = resolveCustomModelConfig();
    if (customConfig) {
        return {
            provider: "custom",
            modelId: customConfig.modelId || "custom-model",
        };
    }

    // 2. AI-native Databricks Model Serving (when running in Databricks Apps or explicitly requested)
    const isDatabricksApp = Boolean(process.env.DATABRICKS_APP_PORT || process.env.DATABRICKS_APP_NAME);
    const databricksConfig = resolveDatabricksModelConfig();
    if (isDatabricksApp && databricksConfig) {
        return {
            provider: "databricks",
            modelId: databricksConfig.defaultModelId || "databricks-meta-llama-3-3-70b-instruct",
        };
    }

    const { providerIds } = loadPiCredentialStore(options.authPath);
    const configured = (providerId: string) => providerConfigured(providerId, providerIds);
    const pi = readPiModelSelection(options);
    if (pi && configured(pi.provider)) return pi;

    // 3. Databricks Model Serving fallback if credentials are present
    if (databricksConfig && (databricksConfig.token || configured("databricks"))) {
        return {
            provider: "databricks",
            modelId: databricksConfig.defaultModelId || "databricks-meta-llama-3-3-70b-instruct",
        };
    }

    // 4. Standard external providers
    if (configured("openai")) return { provider: "openai", modelId: "gpt-4o" };
    if (configured("anthropic")) return { provider: "anthropic", modelId: "claude-3-7-sonnet-20250219" };
    if (configured("google")) return { provider: "google", modelId: "gemini-2.5-pro" };
    if (configured("openrouter")) return { provider: "openrouter", modelId: "anthropic/claude-3.7-sonnet" };

    // 5. Databricks fallback if host was detected
    if (databricksConfig) {
        return {
            provider: "databricks",
            modelId: databricksConfig.defaultModelId || "databricks-meta-llama-3-3-70b-instruct",
        };
    }

    // 6. Offline faux fallback
    return { provider: "faux", modelId: "faux-analyst" };
}

/**
 * Resolves the Databricks AI Gateway fallback model when an external router model is requested.
 * Returns undefined if the primary model is already within the Databricks perimeter, or if Databricks is not configured.
 */
export function resolveModelFallback(primaryRef?: ResolvedModelConfig): ResolvedModelConfig | undefined {
    const primary = primaryRef ?? getDefaultModelRef();

    // In-perimeter Databricks models do not require gateway failover
    if (primary.provider === "databricks" || primary.provider === "gateway") {
        return undefined;
    }

    const databricksConfig = resolveDatabricksModelConfig();
    const isDatabricksConfigured = isDatabricksModelConfigured();

    if (isDatabricksConfigured && databricksConfig) {
        const fallbackModelId =
            process.env.DATABRICKS_FALLBACK_MODEL_ID?.trim() ||
            process.env.DATABRICKS_MODEL_ID?.trim() ||
            databricksConfig.defaultModelId ||
            "databricks-meta-llama-3-3-70b-instruct";
        return {
            provider: "databricks",
            modelId: fallbackModelId,
        };
    }

    return undefined;
}

/**
 * Lists available AI models categorized by source (Databricks Foundation, Databricks AI Gateway,
 * OpenRouter, and Direct/Custom providers), along with current selection and active Databricks AI Gateway fallback info.
 */
export function listAvailableAiModels(options: ModelRegistryOptions = {}): AvailableAiModelsResponse {
    const current = getDefaultModelRef(options);
    const fallbackModel = resolveModelFallback(current);
    const hasDatabricks = isDatabricksModelConfigured();
    const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY?.trim());

    const databricksFoundationList: ModelOptionInfo[] = DATABRICKS_FOUNDATION_MODELS.map((id) => ({
        id: `databricks/${id}`,
        name: id.replace(/^databricks-/, "").replace(/-/g, " "),
        provider: "databricks",
        category: "databricks_foundation",
        reasoning: id.includes("reasoning") || id.includes("dbrx"),
        description: "Zero data egress in-perimeter Databricks Foundation model",
    }));

    const databricksGatewayList: ModelOptionInfo[] = DATABRICKS_GATEWAY_ROUTES.map((route) => ({
        id: `gateway/${route.id}`,
        name: route.name,
        provider: "gateway",
        category: "databricks_gateway",
        reasoning: route.id.includes("thinking") || route.id.includes("3-7"),
        description: route.description,
    }));

    for (const ep of parseConfiguredGatewayEndpoints()) {
        databricksGatewayList.push({
            id: `gateway/${ep}`,
            name: `${ep} (Gateway Endpoint)`,
            provider: "gateway",
            category: "databricks_gateway",
            description: "Custom endpoint on Databricks Model Serving",
        });
    }

    const openRouterList: ModelOptionInfo[] = OPENROUTER_RECOMMENDED_MODELS.map((m) => ({
        id: `openrouter/${m.id}`,
        name: m.name,
        provider: "openrouter",
        category: "openrouter",
        reasoning: m.reasoning,
        description: m.description,
    }));

    for (const modelId of parseConfiguredOpenRouterModels()) {
        if (!openRouterList.some((m) => m.id === `openrouter/${modelId}`)) {
            openRouterList.push({
                id: `openrouter/${modelId}`,
                name: modelId,
                provider: "openrouter",
                category: "openrouter",
                description: "Configured OpenRouter model",
            });
        }
    }

    const otherList: ModelOptionInfo[] = [];
    if (process.env.OPENAI_API_KEY?.trim()) {
        otherList.push({ id: "openai/gpt-4o", name: "GPT-4o (Direct OpenAI)", provider: "openai", category: "other" });
        otherList.push({ id: "openai/gpt-4o-mini", name: "GPT-4o mini (Direct OpenAI)", provider: "openai", category: "other" });
    }
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
        otherList.push({ id: "anthropic/claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet (Direct Anthropic)", provider: "anthropic", category: "other" });
    }
    if (process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()) {
        otherList.push({ id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro (Direct Google)", provider: "google", category: "other" });
    }
    if (isCustomModelConfigured()) {
        const custom = resolveCustomModelConfig();
        otherList.push({
            id: `custom/${custom?.modelId || "custom-model"}`,
            name: custom?.name || "Custom Model Endpoint",
            provider: "custom",
            category: "custom",
            description: custom?.baseUrl,
        });
    }

    return {
        current,
        ...(fallbackModel
            ? {
                fallback: {
                    model: fallbackModel,
                    available: hasDatabricks,
                    reason: "External router calls automatically fail over to Databricks AI Gateway if external rate limits or token exhaustion occur.",
                },
            }
            : {}),
        categories: [
            {
                id: "databricks_foundation",
                name: "Databricks Foundation Models (In-Perimeter)",
                description: "Zero data egress models running directly on Databricks Model Serving.",
                models: databricksFoundationList,
            },
            {
                id: "databricks_gateway",
                name: "Databricks AI Gateway Routes (Zero-Egress Proxy)",
                description: "External models proxied through Databricks AI Gateway with governance and rate limiting.",
                models: databricksGatewayList,
            },
            {
                id: "openrouter",
                name: "OpenRouter & Multi-Model Catalog",
                description: hasOpenRouter
                    ? "Curated multi-model router with automatic Databricks AI Gateway fallback."
                    : "Configure OPENROUTER_API_KEY to activate external routing with Databricks AI Gateway fallback.",
                models: openRouterList,
            },
            ...(otherList.length > 0
                ? [
                    {
                        id: "other",
                        name: "Direct API Keys & Custom Endpoints",
                        description: "Direct vendor API keys configured in the environment.",
                        models: otherList,
                    },
                ]
                : []),
        ],
    };
}
