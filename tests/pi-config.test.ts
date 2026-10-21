import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultModelRef, setupModelsRegistry } from "../src/config";
import { readPiModelSelection } from "../src/pi-config";

async function tempRoot(): Promise<string> {
    return mkdtemp(join(tmpdir(), "dataclaw-pi-"));
}

test("project pi settings override the user settings", async () => {
    const root = await tempRoot();
    const userSettings = join(root, "user-settings.json");
    const auth = join(root, "auth.json");
    await mkdir(join(root, ".pi"), { recursive: true });
    await writeFile(userSettings, JSON.stringify({
        defaultProvider: "openai",
        defaultModel: "gpt-4o",
    }));
    await writeFile(join(root, ".pi", "settings.json"), JSON.stringify({
        defaultProvider: "opencode-go",
        defaultModel: "deepseek-v4.1-flash",
    }));
    await writeFile(auth, JSON.stringify({
        "opencode-go": { type: "api_key", key: "test-key" },
    }));

    const previousProvider = process.env.DEFAULT_MODEL_PROVIDER;
    const previousId = process.env.DEFAULT_MODEL_ID;
    delete process.env.DEFAULT_MODEL_PROVIDER;
    delete process.env.DEFAULT_MODEL_ID;
    try {
        expect(readPiModelSelection({
            projectRoot: root,
            userSettingsPath: userSettings,
        })).toEqual({ provider: "opencode-go", modelId: "deepseek-v4.1-flash" });

        expect(getDefaultModelRef({
            projectRoot: root,
            userSettingsPath: userSettings,
            authPath: auth,
        })).toEqual({ provider: "opencode-go", modelId: "deepseek-v4.1-flash" });

        const models = setupModelsRegistry({
            projectRoot: root,
            userSettingsPath: userSettings,
            authPath: auth,
        });
        expect(models.getModel("opencode-go", "deepseek-v4.1-flash")?.provider).toBe("opencode-go");
    } finally {
        if (previousProvider === undefined) delete process.env.DEFAULT_MODEL_PROVIDER;
        else process.env.DEFAULT_MODEL_PROVIDER = previousProvider;
        if (previousId === undefined) delete process.env.DEFAULT_MODEL_ID;
        else process.env.DEFAULT_MODEL_ID = previousId;
        await rm(root, { recursive: true, force: true });
    }
});

test("a pi model with no credential is not selected", async () => {
    const root = await tempRoot();
    const userSettings = join(root, "user-settings.json");
    const auth = join(root, "auth.json");
    await mkdir(join(root, ".pi"), { recursive: true });
    await writeFile(userSettings, "{}");
    await writeFile(join(root, ".pi", "settings.json"), JSON.stringify({
        defaultProvider: "missing-provider",
        defaultModel: "missing-model",
    }));
    await writeFile(auth, "{}");

    const previousProvider = process.env.DEFAULT_MODEL_PROVIDER;
    const previousId = process.env.DEFAULT_MODEL_ID;
    delete process.env.DEFAULT_MODEL_PROVIDER;
    delete process.env.DEFAULT_MODEL_ID;
    try {
        const selected = getDefaultModelRef({
            projectRoot: root,
            userSettingsPath: userSettings,
            authPath: auth,
        });
        expect(selected.provider).not.toBe("missing-provider");
    } finally {
        if (previousProvider === undefined) delete process.env.DEFAULT_MODEL_PROVIDER;
        else process.env.DEFAULT_MODEL_PROVIDER = previousProvider;
        if (previousId === undefined) delete process.env.DEFAULT_MODEL_ID;
        else process.env.DEFAULT_MODEL_ID = previousId;
        await rm(root, { recursive: true, force: true });
    }
});
