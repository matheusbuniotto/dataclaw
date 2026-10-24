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

/**
 * Creates a provider for Databricks AI-native Model Serving.
 * Interacts with Databricks Foundation Model APIs (such as Meta Llama 3.3 70B Instruct or DBRX)
 * using the standard OpenAI-compatible `/serving-endpoints` interface.
 */
export function createDatabricksModelProvider(config?: DatabricksModelConfig) {
    const resolved = config ?? resolveDatabricksModelConfig();
    const baseUrl = resolved?.baseUrl ?? "https://dbc-cloud.databricks.com/serving-endpoints";
    const defaultModelId = resolved?.defaultModelId ?? "databricks-meta-llama-3-3-70b-instruct";

    const allModelIds = Array.from(new Set([
        defaultModelId,
        ...DATABRICKS_FOUNDATION_MODELS,
    ]));

    const models = allModelIds.map((id) => ({
        id,
        name: id.replace(/^databricks-/, "").replace(/-/g, " "),
        api: "openai-completions" as const,
        provider: "databricks",
        baseUrl,
        reasoning: false,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
        type: "chat" as const,
    }));

    return createProvider({
        id: "databricks",
        name: "Databricks Model Serving",
        baseUrl,
        auth: {
            apiKey: {
                name: "Databricks Token",
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
    if (databricksConfig || configured("databricks")) {
        models.setProvider(createDatabricksModelProvider(databricksConfig));
    }

    if (configured("openai")) models.setProvider(openaiProvider());
    if (configured("anthropic")) models.setProvider(anthropicProvider());
    if (configured("google")) models.setProvider(googleProvider());
    if (configured("openrouter")) models.setProvider(openrouterProvider());
    if (configured("opencode-go")) models.setProvider(opencodeGoProvider());

    const hasAnyRealProvider =
        Boolean(customConfig) ||
        Boolean(databricksConfig) ||
        REAL_PROVIDERS.some(configured);

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
