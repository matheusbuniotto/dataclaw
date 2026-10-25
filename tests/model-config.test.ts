import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    createCustomModelProvider,
    createDatabricksModelProvider,
    DATABRICKS_FOUNDATION_MODELS,
    DATABRICKS_GATEWAY_ROUTES,
    fetchRemoteRouterModels,
    getDefaultModelRef,
    isCustomModelConfigured,
    isDatabricksModelConfigured,
    listAvailableAiModels,
    normalizeBaseUrl,
    OPENROUTER_RECOMMENDED_MODELS,
    parseConfiguredGatewayEndpoints,
    parseConfiguredOpenRouterModels,
    resolveCustomModelConfig,
    resolveDatabricksModelConfig,
    resolveModelFallback,
    setupModelsRegistry,
} from "../src/config";

const isolatedOptions = {
    projectRoot: "/tmp/dataclaw-nonexistent",
    userSettingsPath: "/tmp/dataclaw-nonexistent/user-settings.json",
    authPath: "/tmp/dataclaw-nonexistent/auth.json",
};

describe("Model Configuration & Provider Wrapping", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.CUSTOM_MODEL_BASE_URL;
        delete process.env.CUSTOM_MODEL_API_KEY;
        delete process.env.CUSTOM_MODEL_ID;
        delete process.env.CUSTOM_MODEL_NAME;
        delete process.env.DATABRICKS_MODEL_BASE_URL;
        delete process.env.DATABRICKS_MODEL_API_KEY;
        delete process.env.DATABRICKS_MODEL_ID;
        delete process.env.DATABRICKS_HOST;
        delete process.env.DATABRICKS_TOKEN;
        delete process.env.DATABRICKS_APP_PORT;
        delete process.env.DATABRICKS_APP_NAME;
        delete process.env.DEFAULT_MODEL_PROVIDER;
        delete process.env.DEFAULT_MODEL_ID;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.OPENROUTER_MODELS;
        delete process.env.DATABRICKS_GATEWAY_ENDPOINTS;
        delete process.env.DATABRICKS_FALLBACK_MODEL_ID;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    test("normalizeBaseUrl formats URLs, schemes, and removes /chat/completions", () => {
        expect(normalizeBaseUrl("https://example.com/v1")).toBe("https://example.com/v1");
        expect(normalizeBaseUrl("https://example.com/v1/")).toBe("https://example.com/v1");
        expect(normalizeBaseUrl("example.com/v1")).toBe("https://example.com/v1");
        expect(normalizeBaseUrl("http://localhost:8000/v1/chat/completions")).toBe("http://localhost:8000/v1");
        expect(normalizeBaseUrl("https://gateway.internal/v1/chat/completions/")).toBe("https://gateway.internal/v1");
    });

    describe("Custom Model Provider (DAB secrets / custom endpoints)", () => {
        test("isCustomModelConfigured returns false when no custom vars are set", () => {
            expect(isCustomModelConfigured()).toBe(false);
            expect(resolveCustomModelConfig()).toBeUndefined();
        });

        test("resolves custom model with base_url and DAB api_key secret", () => {
            process.env.CUSTOM_MODEL_BASE_URL = "https://custom-gateway.internal/v1";
            process.env.CUSTOM_MODEL_API_KEY = "secret-token-from-dab";
            process.env.CUSTOM_MODEL_ID = "meta-llama/Llama-3.3-70B-Instruct";
            process.env.CUSTOM_MODEL_NAME = "Internal Llama Gateway";

            expect(isCustomModelConfigured()).toBe(true);
            const cfg = resolveCustomModelConfig();
            expect(cfg).toBeDefined();
            expect(cfg?.baseUrl).toBe("https://custom-gateway.internal/v1");
            expect(cfg?.apiKey).toBe("secret-token-from-dab");
            expect(cfg?.modelId).toBe("meta-llama/Llama-3.3-70B-Instruct");
            expect(cfg?.name).toBe("Internal Llama Gateway");
        });

        test("createCustomModelProvider registers model and resolves auth", async () => {
            process.env.CUSTOM_MODEL_BASE_URL = "https://custom-gateway.internal/v1";
            process.env.CUSTOM_MODEL_API_KEY = "test-secret-key-123";
            process.env.CUSTOM_MODEL_ID = "my-custom-model";

            const provider = createCustomModelProvider();
            expect(provider.id).toBe("custom");
            expect(provider.baseUrl).toBe("https://custom-gateway.internal/v1");

            const models = await provider.getModels();
            const modelIds = models.map((m) => m.id);
            expect(modelIds).toContain("my-custom-model");
            expect(modelIds).toContain("custom-model");

            const model = models.find((m) => m.id === "my-custom-model");
            expect(model?.api).toBe("openai-completions");
            expect(model?.baseUrl).toBe("https://custom-gateway.internal/v1");

            // Test auth resolution
            const auth = await provider.auth.apiKey?.resolve({
                ctx: {
                    env: async (key: string) => process.env[key],
                    fileExists: async () => false,
                },
                signal: new AbortController().signal,
            });
            expect(auth?.auth.apiKey).toBe("test-secret-key-123");
        });

        test("getDefaultModelRef picks custom model when configured (even with ambient pi files)", () => {
            process.env.CUSTOM_MODEL_BASE_URL = "https://custom-gateway.internal/v1";
            process.env.CUSTOM_MODEL_API_KEY = "secret-token";
            process.env.CUSTOM_MODEL_ID = "custom-llama";

            // Even without isolated options, custom model takes precedence over ambient .pi/settings.json
            const ref = getDefaultModelRef();
            expect(ref).toEqual({
                provider: "custom",
                modelId: "custom-llama",
            });
        });
    });

    describe("Databricks AI-Native Model Serving Fallback", () => {
        test("isDatabricksModelConfigured returns false when Databricks env is absent", () => {
            expect(isDatabricksModelConfigured()).toBe(false);
            expect(resolveDatabricksModelConfig()).toBeUndefined();
        });

        test("resolves Databricks Model Serving from DATABRICKS_HOST and DATABRICKS_TOKEN", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test-workspace.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_workspace_token_456";

            expect(isDatabricksModelConfigured()).toBe(true);
            const cfg = resolveDatabricksModelConfig();
            expect(cfg).toBeDefined();
            expect(cfg?.host).toBe("https://dbc-test-workspace.cloud.databricks.com");
            expect(cfg?.token).toBe("dapi_workspace_token_456");
            expect(cfg?.baseUrl).toBe("https://dbc-test-workspace.cloud.databricks.com/serving-endpoints");
            expect(cfg?.defaultModelId).toBe("databricks-meta-llama-3-3-70b-instruct");
        });

        test("automatically activates in Databricks Apps container (DATABRICKS_APP_PORT set)", () => {
            process.env.DATABRICKS_APP_PORT = "8000";
            process.env.DATABRICKS_HOST = "dbc-app-workspace.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_app_sp_token";

            expect(isDatabricksModelConfigured()).toBe(true);
            const cfg = resolveDatabricksModelConfig();
            expect(cfg?.baseUrl).toBe("https://dbc-app-workspace.cloud.databricks.com/serving-endpoints");
            expect(cfg?.defaultModelId).toBe("databricks-meta-llama-3-3-70b-instruct");

            // In Databricks Apps, Databricks Model Serving is selected by default
            expect(getDefaultModelRef()).toEqual({
                provider: "databricks",
                modelId: "databricks-meta-llama-3-3-70b-instruct",
            });
        });

        test("respects DATABRICKS_MODEL_ID override", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";
            process.env.DATABRICKS_MODEL_ID = "databricks-dbrx-instruct";

            const cfg = resolveDatabricksModelConfig();
            expect(cfg?.defaultModelId).toBe("databricks-dbrx-instruct");
        });

        test("createDatabricksModelProvider registers Foundation models and resolves token", async () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token_abc";

            const provider = createDatabricksModelProvider();
            expect(provider.id).toBe("databricks");
            expect(provider.baseUrl).toBe("https://dbc-test.cloud.databricks.com/serving-endpoints");

            const models = await provider.getModels();
            const modelIds = models.map((m) => m.id);

            // Foundation models must all be present
            for (const fm of DATABRICKS_FOUNDATION_MODELS) {
                expect(modelIds).toContain(fm);
            }

            const llamaModel = models.find((m) => m.id === "databricks-meta-llama-3-3-70b-instruct");
            expect(llamaModel?.api).toBe("openai-completions");
            expect(llamaModel?.baseUrl).toBe("https://dbc-test.cloud.databricks.com/serving-endpoints");

            // Test token resolution
            const auth = await provider.auth.apiKey?.resolve({
                ctx: {
                    env: async (key: string) => process.env[key],
                    fileExists: async () => false,
                },
                signal: new AbortController().signal,
            });
            expect(auth?.auth.apiKey).toBe("dapi_token_abc");
        });

        test("getDefaultModelRef falls back to Databricks Model Serving when custom model is not set", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token_xyz";

            const ref = getDefaultModelRef(isolatedOptions);
            expect(ref).toEqual({
                provider: "databricks",
                modelId: "databricks-meta-llama-3-3-70b-instruct",
            });
        });
    });

    describe("Priority & Fallback Hierarchy", () => {
        test("explicit DEFAULT_MODEL_PROVIDER & DEFAULT_MODEL_ID win over all", () => {
            process.env.DEFAULT_MODEL_PROVIDER = "custom";
            process.env.DEFAULT_MODEL_ID = "forced-model";
            process.env.CUSTOM_MODEL_BASE_URL = "https://gateway.com/v1";
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            expect(getDefaultModelRef(isolatedOptions)).toEqual({
                provider: "custom",
                modelId: "forced-model",
            });
        });

        test("Custom model (DAB secrets) takes precedence over Databricks Model Serving", () => {
            process.env.CUSTOM_MODEL_BASE_URL = "https://custom-gateway.internal/v1";
            process.env.CUSTOM_MODEL_API_KEY = "custom-key";
            process.env.CUSTOM_MODEL_ID = "llama-custom-vllm";

            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            expect(getDefaultModelRef(isolatedOptions)).toEqual({
                provider: "custom",
                modelId: "llama-custom-vllm",
            });
        });

        test("Databricks Model Serving takes precedence when no custom model is configured", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            expect(getDefaultModelRef(isolatedOptions)).toEqual({
                provider: "databricks",
                modelId: "databricks-meta-llama-3-3-70b-instruct",
            });
        });

        test("falls back to faux provider when neither custom nor Databricks nor keys are configured", () => {
            expect(getDefaultModelRef(isolatedOptions)).toEqual({
                provider: "faux",
                modelId: "faux-analyst",
            });
        });
    });

    describe("setupModelsRegistry Integration", () => {
        test("registers both custom and databricks providers when configured", async () => {
            process.env.CUSTOM_MODEL_BASE_URL = "https://my-vllm.internal/v1";
            process.env.CUSTOM_MODEL_API_KEY = "vllm-token";
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            const registry = setupModelsRegistry(isolatedOptions);

            const customModel = await registry.getModel("custom", "custom-model");
            expect(customModel).toBeDefined();
            expect(customModel?.baseUrl).toBe("https://my-vllm.internal/v1");

            const databricksModel = await registry.getModel("databricks", "databricks-meta-llama-3-3-70b-instruct");
            expect(databricksModel).toBeDefined();
            expect(databricksModel?.baseUrl).toBe("https://dbc-test.cloud.databricks.com/serving-endpoints");
        });
    });

    describe("Databricks AI Gateway Routes & Referencing", () => {
        test("createDatabricksModelProvider supports gateway providerId and routes", async () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            const provider = createDatabricksModelProvider(undefined, "gateway");
            expect(provider.id).toBe("gateway");
            expect(provider.name).toBe("Databricks AI Gateway");

            const models = await provider.getModels();
            const modelIds = models.map((m) => m.id);

            // Gateway routes must be registered
            expect(modelIds).toContain("openai-gpt-4o");
            expect(modelIds).toContain("claude-3-7-sonnet");
            expect(modelIds).toContain("mistral-large");
        });

        test("parses custom DATABRICKS_GATEWAY_ENDPOINTS", () => {
            process.env.DATABRICKS_GATEWAY_ENDPOINTS = "fraud-detector, sales-copilot, custom-qa";
            const endpoints = parseConfiguredGatewayEndpoints();
            expect(endpoints).toEqual(["fraud-detector", "sales-copilot", "custom-qa"]);
        });

        test("dynamic model resolution resolves arbitrary Databricks gateway endpoint names", async () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            const registry = setupModelsRegistry(isolatedOptions);

            const dynamicEndpoint = await registry.getModel("gateway", "my-internal-fine-tuned-endpoint");
            expect(dynamicEndpoint).toBeDefined();
            expect(dynamicEndpoint?.id).toBe("my-internal-fine-tuned-endpoint");
            expect(dynamicEndpoint?.provider).toBe("gateway");
            expect(dynamicEndpoint?.baseUrl).toBe("https://dbc-test.cloud.databricks.com/serving-endpoints");
        });
    });

    describe("OpenRouter Catalog & Dynamic Resolution", () => {
        test("OPENROUTER_RECOMMENDED_MODELS starts with openai/gpt-6-luna with reasoning enabled", () => {
            expect(OPENROUTER_RECOMMENDED_MODELS[0].id).toBe("openai/gpt-6-luna");
            expect(OPENROUTER_RECOMMENDED_MODELS[0].name).toBe("OpenAI GPT-6 Luna");
            expect(OPENROUTER_RECOMMENDED_MODELS[0].reasoning).toBe(true);

            const ids = OPENROUTER_RECOMMENDED_MODELS.map((m) => m.id);
            expect(ids).toContain("anthropic/claude-3.7-sonnet");
            expect(ids).toContain("deepseek/deepseek-r1");
            expect(ids).toContain("openai/gpt-4o");
            expect(ids).toContain("google/gemini-2.5-pro");
            expect(ids).toContain("qwen/qwen-2.5-coder-32b-instruct");
        });

        test("parses custom OPENROUTER_MODELS with comma separation, labels, or JSON format", () => {
            // Standard comma-separated
            process.env.OPENROUTER_MODELS = "meta-llama/llama-3.2-3b-instruct, mistralai/codestral-2501";
            expect(parseConfiguredOpenRouterModels()).toEqual(["meta-llama/llama-3.2-3b-instruct", "mistralai/codestral-2501"]);

            // With :Friendly Label syntax
            process.env.OPENROUTER_MODELS = "openai/gpt-6-luna:Luna Reasoning, deepseek/deepseek-r1:DeepSeek R1";
            expect(parseConfiguredOpenRouterModels()).toEqual(["openai/gpt-6-luna", "deepseek/deepseek-r1"]);

            // JSON array format
            delete process.env.OPENROUTER_MODELS;
            process.env.AI_MODELS = JSON.stringify([
                "openai/gpt-6-luna",
                { id: "anthropic/claude-3.7-sonnet", name: "Claude" },
            ]);
            expect(parseConfiguredOpenRouterModels()).toEqual(["openai/gpt-6-luna", "anthropic/claude-3.7-sonnet"]);

            // Fallback env RECOMMENDED_MODELS
            delete process.env.AI_MODELS;
            process.env.RECOMMENDED_MODELS = "meta-llama/llama-3.3-70b-instruct";
            expect(parseConfiguredOpenRouterModels()).toEqual(["meta-llama/llama-3.3-70b-instruct"]);
        });

        test("registers recommended models and dynamically synthesizes unknown OpenRouter models", async () => {
            process.env.OPENROUTER_API_KEY = "sk-or-test-key";

            const registry = setupModelsRegistry(isolatedOptions);

            const luna = await registry.getModel("openrouter", "openai/gpt-6-luna");
            expect(luna).toBeDefined();
            expect(luna?.id).toBe("openai/gpt-6-luna");

            const sonnet = await registry.getModel("openrouter", "anthropic/claude-3.7-sonnet");
            expect(sonnet).toBeDefined();
            expect(sonnet?.id).toBe("anthropic/claude-3.7-sonnet");

            const dynamicModel = await registry.getModel("openrouter", "custom-org/experimental-model");
            expect(dynamicModel).toBeDefined();
            expect(dynamicModel?.id).toBe("custom-org/experimental-model");
            expect(dynamicModel?.provider).toBe("openrouter");
        });

        test("fetchRemoteRouterModels discovers live models from OpenAI and Ollama formats", async () => {
            const originalFetch = globalThis.fetch;
            try {
                // OpenAI format
                globalThis.fetch = (async (url: any, init?: any) => {
                    expect(String(url)).toBe("https://openrouter.ai/api/v1/models");
                    expect(init?.headers?.Authorization).toBe("Bearer test-token");
                    return new Response(
                        JSON.stringify({
                            data: [
                                { id: "openai/gpt-6-luna", name: "OpenAI GPT-6 Luna", reasoning: true },
                                { id: "custom-provider/fast-model", name: "Fast Model" },
                            ],
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                }) as any;

                const models = await fetchRemoteRouterModels({
                    baseUrl: "https://openrouter.ai/api/v1",
                    apiKey: "test-token",
                });
                expect(models.length).toBe(2);
                expect(models[0]!.id).toBe("openrouter/openai/gpt-6-luna");
                expect(models[0]!.reasoning).toBe(true);
                expect(models[1]!.id).toBe("openrouter/custom-provider/fast-model");

                // Ollama format with local endpoint
                globalThis.fetch = (async (url: any) => {
                    expect(String(url)).toBe("http://localhost:11434/v1/models");
                    return new Response(
                        JSON.stringify({
                            models: [
                                { name: "deepseek-r1:latest" },
                                { name: "llama3.2:latest" },
                            ],
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                }) as any;

                const ollamaModels = await fetchRemoteRouterModels({
                    baseUrl: "http://localhost:11434/v1",
                });
                expect(ollamaModels.length).toBe(2);
                expect(ollamaModels[0]!.id).toBe("deepseek-r1:latest");
                expect(ollamaModels[0]!.reasoning).toBe(true);
                expect(ollamaModels[0]!.provider).toBe("custom");
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe("Databricks AI Gateway Fallback Resolution", () => {
        test("resolves fallback when primary is OpenRouter and Databricks is configured", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            const fallback = resolveModelFallback({
                provider: "openrouter",
                modelId: "anthropic/claude-3.7-sonnet",
            });

            expect(fallback).toEqual({
                provider: "databricks",
                modelId: "databricks-meta-llama-3-3-70b-instruct",
            });
        });

        test("returns undefined fallback when primary is already in-perimeter (databricks or gateway)", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            expect(resolveModelFallback({ provider: "databricks", modelId: "databricks-dbrx-instruct" })).toBeUndefined();
            expect(resolveModelFallback({ provider: "gateway", modelId: "openai-gpt-4o" })).toBeUndefined();
        });

        test("returns undefined fallback when Databricks is not configured", () => {
            const fallback = resolveModelFallback({
                provider: "openrouter",
                modelId: "deepseek/deepseek-r1",
            });
            expect(fallback).toBeUndefined();
        });

        test("respects DATABRICKS_FALLBACK_MODEL_ID override", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";
            process.env.DATABRICKS_FALLBACK_MODEL_ID = "databricks-dbrx-instruct";

            const fallback = resolveModelFallback({
                provider: "openrouter",
                modelId: "openai/gpt-4o",
            });

            expect(fallback).toEqual({
                provider: "databricks",
                modelId: "databricks-dbrx-instruct",
            });
        });
    });

    describe("listAvailableAiModels Catalog", () => {
        test("returns categorized models and fallback info", () => {
            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";
            process.env.OPENROUTER_API_KEY = "sk-or-test";
            process.env.DEFAULT_MODEL_PROVIDER = "openrouter";
            process.env.DEFAULT_MODEL_ID = "anthropic/claude-3.7-sonnet";

            const catalog = listAvailableAiModels(isolatedOptions);

            expect(catalog.current).toEqual({
                provider: "openrouter",
                modelId: "anthropic/claude-3.7-sonnet",
            });

            expect(catalog.fallback).toBeDefined();
            expect(catalog.fallback?.model).toEqual({
                provider: "databricks",
                modelId: "databricks-meta-llama-3-3-70b-instruct",
            });
            expect(catalog.fallback?.available).toBe(true);

            const categoryIds = catalog.categories.map((c) => c.id);
            expect(categoryIds).toContain("databricks_foundation");
            expect(categoryIds).toContain("databricks_gateway");
            expect(categoryIds).toContain("openrouter");

            const foundationCat = catalog.categories.find((c) => c.id === "databricks_foundation");
            expect(foundationCat?.models.some((m) => m.id === "databricks/databricks-meta-llama-3-3-70b-instruct")).toBe(true);

            const gatewayCat = catalog.categories.find((c) => c.id === "databricks_gateway");
            expect(gatewayCat?.models.some((m) => m.id === "gateway/openai-gpt-4o")).toBe(true);

            const openRouterCat = catalog.categories.find((c) => c.id === "openrouter");
            expect(openRouterCat?.models.some((m) => m.id === "openrouter/anthropic/claude-3.7-sonnet")).toBe(true);
        });
    });

    describe("Resilient Streaming Fallback to Databricks Gateway", () => {
        test("streamSimple catches primary failure and streams from Databricks fallback model", async () => {
            const { fauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai/providers/faux");

            process.env.DATABRICKS_HOST = "https://dbc-test.cloud.databricks.com";
            process.env.DATABRICKS_TOKEN = "dapi_token";

            const registry = setupModelsRegistry(isolatedOptions);

            const brokenProvider = {
                id: "broken-router",
                name: "Broken Router",
                baseUrl: "https://broken.example.com",
                auth: { apiKey: { name: "Key", resolve: async () => ({ auth: { apiKey: "key" } }) } },
                getModels: () => [{
                    id: "fragile-model",
                    name: "Fragile Model",
                    api: "openai-completions" as const,
                    provider: "broken-router",
                    baseUrl: "https://broken.example.com",
                    reasoning: false,
                    input: ["text" as const],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 128_000,
                    maxTokens: 4096,
                    type: "chat" as const,
                }],
                getAllModels: () => [],
                streamSimple: () => {
                    throw new Error("HTTP 429: Too Many Requests / Quota Exceeded");
                },
            };

            const databricksFaux = fauxProvider({
                provider: "databricks",
                models: [{ id: "databricks-meta-llama-3-3-70b-instruct", name: "Databricks Llama 3.3" }],
            });
            databricksFaux.setResponses([
                fauxAssistantMessage("Recovered seamlessly via Databricks AI Gateway!"),
            ]);

            registry.setProvider(brokenProvider as any);
            registry.setProvider(databricksFaux.provider);

            const primaryModel = registry.getModel("broken-router", "fragile-model")!;
            expect(primaryModel).toBeDefined();

            const stream = registry.streamSimple(primaryModel, {
                messages: [{ role: "user", content: "test", timestamp: Date.now() }],
            });
            const chunks: string[] = [];
            for await (const event of stream) {
                if (event.type === "text_delta" && event.delta) {
                    chunks.push(event.delta);
                }
            }

            const result = await stream.result();
            expect(result.stopReason).toBe("stop");
            expect(result.provider).toBe("databricks");
            expect(chunks.join("")).toContain("Recovered seamlessly via Databricks AI Gateway!");
        });
    });
});
