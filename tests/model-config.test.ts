import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    createCustomModelProvider,
    createDatabricksModelProvider,
    DATABRICKS_FOUNDATION_MODELS,
    getDefaultModelRef,
    isCustomModelConfigured,
    isDatabricksModelConfigured,
    normalizeBaseUrl,
    resolveCustomModelConfig,
    resolveDatabricksModelConfig,
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
});
