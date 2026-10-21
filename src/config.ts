import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { fauxProvider, fauxAssistantMessage, type FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
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

const REAL_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "opencode-go"] as const;

export function setupModelsRegistry(options: ModelRegistryOptions = {}) {
    const { store, providerIds } = loadPiCredentialStore(options.authPath);
    const models = createModels({ credentials: store });
    const configured = (providerId: string) => providerConfigured(providerId, providerIds);

    if (configured("openai")) models.setProvider(openaiProvider());
    if (configured("anthropic")) models.setProvider(anthropicProvider());
    if (configured("google")) models.setProvider(googleProvider());
    if (configured("openrouter")) models.setProvider(openrouterProvider());
    if (configured("opencode-go")) models.setProvider(opencodeGoProvider());

    if (options.fauxHandle) {
        models.setProvider(options.fauxHandle.provider);
    } else if (!REAL_PROVIDERS.some(configured)) {
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

    const { providerIds } = loadPiCredentialStore(options.authPath);
    const configured = (providerId: string) => providerConfigured(providerId, providerIds);
    const pi = readPiModelSelection(options);
    if (pi && configured(pi.provider)) return pi;

    if (configured("openai")) return { provider: "openai", modelId: "gpt-4o" };
    if (configured("anthropic")) return { provider: "anthropic", modelId: "claude-3-7-sonnet-20250219" };
    if (configured("google")) return { provider: "google", modelId: "gemini-2.5-pro" };
    if (configured("openrouter")) return { provider: "openrouter", modelId: "anthropic/claude-3.7-sonnet" };

    return { provider: "faux", modelId: "faux-analyst" };
}
