import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

/** Where DataClaw reads Pi's model choice and saved credentials. */
export interface PiConfigOptions {
    /** Repo root. Project settings live in `<projectRoot>/.pi/settings.json`. */
    projectRoot?: string;
    /** Defaults to `~/.pi/agent/settings.json`. */
    userSettingsPath?: string;
    /** Defaults to `~/.pi/agent/auth.json`. */
    authPath?: string;
}

export interface PiModelSelection {
    provider: string;
    modelId: string;
}

const PROVIDER_ENV: Record<string, readonly string[]> = {
    openai: ["OPENAI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    "opencode-go": ["OPENCODE_API_KEY"],
    opencode: ["OPENCODE_API_KEY"],
    custom: ["CUSTOM_MODEL_API_KEY", "DATABRICKS_MODEL_API_KEY", "MODEL_API_KEY"],
    databricks: ["DATABRICKS_TOKEN", "DATABRICKS_MODEL_API_KEY"],
};

export function defaultPiUserSettingsPath(): string {
    return join(homedir(), ".pi", "agent", "settings.json");
}

export function defaultPiAuthPath(): string {
    return join(homedir(), ".pi", "agent", "auth.json");
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return undefined;
    }
}

function settingsModel(path: string): Partial<PiModelSelection> {
    const parsed = readJson(path);
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as { defaultProvider?: unknown; defaultModel?: unknown };
    return {
        ...(typeof record.defaultProvider === "string" && record.defaultProvider.trim()
            ? { provider: record.defaultProvider.trim() }
            : {}),
        ...(typeof record.defaultModel === "string" && record.defaultModel.trim()
            ? { modelId: record.defaultModel.trim() }
            : {}),
    };
}

/**
 * Model selected in Pi. Project `.pi/settings.json` overrides the user file.
 * A file that names only a provider or only a model is ignored.
 */
export function readPiModelSelection(options: PiConfigOptions = {}): PiModelSelection | undefined {
    const userPath = options.userSettingsPath ?? defaultPiUserSettingsPath();
    const projectPath = join(options.projectRoot ?? process.cwd(), ".pi", "settings.json");
    const merged = { ...settingsModel(userPath), ...settingsModel(projectPath) };
    if (!merged.provider || !merged.modelId) return undefined;
    return { provider: merged.provider, modelId: merged.modelId };
}

function resolveKey(key: string): string | undefined {
    const trimmed = key.trim();
    if (!trimmed) return undefined;
    if (!trimmed.startsWith("!")) return trimmed;
    try {
        const output = execFileSync("sh", ["-c", trimmed.slice(1)], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15_000,
        }).trim();
        return output || undefined;
    } catch {
        return undefined;
    }
}

function normalizeCredential(value: unknown): Credential | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as { type?: unknown; key?: unknown; access?: unknown; refresh?: unknown; expires?: unknown };
    if (record.type === "api_key" && typeof record.key === "string") {
        const key = resolveKey(record.key);
        return key ? { type: "api_key", key } : undefined;
    }
    if (
        record.type === "oauth"
        && typeof record.access === "string"
        && typeof record.refresh === "string"
        && typeof record.expires === "number"
    ) {
        return record as Credential;
    }
    return undefined;
}

/** Credentials from Pi's `auth.json`. Reads stay in memory; DataClaw does not write the file. */
export function loadPiCredentialStore(authPath = defaultPiAuthPath()): {
    store: CredentialStore;
    providerIds: ReadonlySet<string>;
} {
    const credentials = new Map<string, Credential>();
    const parsed = readJson(authPath);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [providerId, value] of Object.entries(parsed)) {
            const credential = normalizeCredential(value);
            if (credential) credentials.set(providerId, credential);
        }
    }

    const store: CredentialStore = {
        async read(providerId) {
            return credentials.get(providerId);
        },
        async list() {
            return [...credentials].map(([providerId, credential]) => ({
                providerId,
                type: credential.type,
            }));
        },
        async modify(providerId, fn) {
            const next = await fn(credentials.get(providerId));
            if (next) credentials.set(providerId, next);
            return next ?? credentials.get(providerId);
        },
        async delete(providerId) {
            credentials.delete(providerId);
        },
    };

    return { store, providerIds: new Set(credentials.keys()) };
}

export function providerEnvNames(providerId: string): readonly string[] {
    return PROVIDER_ENV[providerId] ?? [];
}

export function providerConfigured(
    providerId: string,
    providerIds: ReadonlySet<string>,
): boolean {
    if (providerIds.has(providerId)) return true;
    if (providerId === "custom") {
        return Boolean(
            process.env.CUSTOM_MODEL_BASE_URL?.trim() ||
            process.env.CUSTOM_MODEL_API_KEY?.trim() ||
            process.env.DATABRICKS_MODEL_BASE_URL?.trim() ||
            process.env.DATABRICKS_MODEL_API_KEY?.trim() ||
            process.env.MODEL_BASE_URL?.trim(),
        );
    }
    if (providerId === "databricks") {
        const hasHost = Boolean(
            process.env.DATABRICKS_HOST?.trim() ||
            process.env.DATABRICKS_PROFILE?.trim() ||
            process.env.DATABRICKS_APP_PORT,
        );
        const hasToken = Boolean(
            process.env.DATABRICKS_TOKEN?.trim() ||
            process.env.DATABRICKS_MODEL_API_KEY?.trim(),
        );
        return hasHost && hasToken;
    }
    return providerEnvNames(providerId).some((name) => Boolean(process.env[name]?.trim()));
}
