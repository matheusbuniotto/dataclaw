import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DIALECT_NAMES, PluginError, type CapabilityId, type LoadedPlugin, type PluginManifest } from "./types";

const CAPABILITY = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*@\d+$/;
const NAME = /^[a-z0-9][a-z0-9_.-]*$/;

export function parseCapability(id: string): { domain: string; name: string; major: number } {
    if (!CAPABILITY.test(id)) throw new PluginError(`invalid capability id "${id}" (expected domain.name@major)`, { code: "manifest" });
    const [qualified, major] = id.split("@") as [string, string];
    const dot = qualified.indexOf(".");
    return { domain: qualified.slice(0, dot), name: qualified.slice(dot + 1), major: Number(major) };
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
    typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

const DATA_SOURCE_TOOL_ROLES = ["query", "describe", "profile", "inventory"] as const;

/**
 * Validate the `dataSource` block. Every message names the first problem in the block, and the
 * caller prefixes the manifest path, so a provider author sees `plugins/x/plugin.json: "..."`.
 */
function validateDataSource(raw: unknown, transportType: string, fail: (msg: string) => never): void {
    if (transportType === "script") fail(`"dataSource" requires an MCP transport (mcp or mcp-http), not a script`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(`"dataSource" must be an object`);
    const block = raw as Record<string, unknown>;

    if (typeof block.dialect !== "string" || !(DIALECT_NAMES as readonly string[]).includes(block.dialect)) {
        fail(`"dataSource.dialect" must be one of: ${DIALECT_NAMES.join(", ")}`);
    }

    if (typeof block.tools !== "object" || block.tools === null || Array.isArray(block.tools)) {
        fail(`"dataSource.tools" must be an object`);
    }
    const tools = block.tools as Record<string, unknown>;
    if (typeof tools.query !== "string" || !tools.query.trim()) {
        fail(`"dataSource.tools.query" must be a non-empty string`);
    }
    const seen: string[] = [];
    for (const role of DATA_SOURCE_TOOL_ROLES) {
        const value = tools[role];
        if (value === undefined) continue;
        if (typeof value !== "string" || !value.trim()) fail(`"dataSource.tools.${role}" must be a non-empty string`);
        if (seen.includes(value as string)) fail(`"dataSource.tools.${role}" repeats the tool "${value}"`);
        seen.push(value as string);
    }

    if (typeof block.readOnly !== "object" || block.readOnly === null || Array.isArray(block.readOnly)) {
        fail(`"dataSource.readOnly" must be an object`);
    }
    const readOnly = block.readOnly as Record<string, unknown>;
    if (readOnly.mode !== "tool" && readOnly.mode !== "role" && readOnly.mode !== "checked") {
        fail(`"dataSource.readOnly.mode" must be "tool", "role" or "checked"`);
    }
    if (readOnly.tool !== undefined && (typeof readOnly.tool !== "string" || !readOnly.tool.trim())) {
        fail(`"dataSource.readOnly.tool" must be a non-empty string`);
    }
    if (readOnly.argument !== undefined && (typeof readOnly.argument !== "string" || !readOnly.argument.trim())) {
        fail(`"dataSource.readOnly.argument" must be a non-empty string`);
    }
    if ((readOnly.argument === undefined) !== (readOnly.value === undefined)) {
        fail(`"dataSource.readOnly.argument" and "value" must be provided together`);
    }
    if (readOnly.value !== undefined && typeof readOnly.value !== "boolean" && typeof readOnly.value !== "string") {
        fail(`"dataSource.readOnly.value" must be a boolean or a string`);
    }
    if (readOnly.mode !== "tool" && (readOnly.tool !== undefined || readOnly.argument !== undefined || readOnly.value !== undefined)) {
        fail(`"dataSource.readOnly" uses tool/argument/value only with mode "tool"`);
    }
    if (readOnly.note !== undefined && typeof readOnly.note !== "string") {
        fail(`"dataSource.readOnly.note" must be a string`);
    }

    if (block.auth !== undefined) {
        if (!Array.isArray(block.auth)) fail(`"dataSource.auth" must be an array`);
        for (const entry of block.auth as unknown[]) {
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) fail(`"dataSource.auth" entries must be objects`);
            const auth = entry as Record<string, unknown>;
            if (auth.kind === "env") {
                const vars = auth.vars;
                if (!Array.isArray(vars) || vars.length === 0 || !vars.every((v) => typeof v === "string" && v.trim())) {
                    fail(`"dataSource.auth" env entry needs a non-empty "vars" array of names`);
                }
            } else if (auth.kind === "cli-profile") {
                if (auth.default !== undefined && typeof auth.default !== "string") {
                    fail(`"dataSource.auth" cli-profile "default" must be a string`);
                }
            } else if (auth.kind !== "oauth" && auth.kind !== "service-principal") {
                fail(`"dataSource.auth.kind" must be env, cli-profile, oauth or service-principal`);
            }
        }
    }

    if (block.arguments !== undefined) {
        if (typeof block.arguments !== "object" || block.arguments === null || Array.isArray(block.arguments)) {
            fail(`"dataSource.arguments" must be an object`);
        }
        for (const role of DATA_SOURCE_TOOL_ROLES) {
            const name = (block.arguments as Record<string, unknown>)[role];
            if (name !== undefined && (typeof name !== "string" || !name.trim())) {
                fail(`"dataSource.arguments.${role}" must be a non-empty string`);
            }
        }
    }
}

/** Validate a parsed manifest. Throws PluginError naming the source and the first problem. */
export function validateManifest(raw: unknown, source: string): PluginManifest {
    const fail = (msg: string): never => {
        throw new PluginError(`${source}: ${msg}`, { code: "manifest" });
    };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("manifest must be a JSON object");
    const m = raw as Record<string, unknown>;
    for (const key of ["name", "version", "description", "domain"] as const) {
        if (typeof m[key] !== "string" || !(m[key] as string).trim()) fail(`"${key}" must be a non-empty string`);
    }
    if (!NAME.test(m.name as string)) fail(`"name" must match ${NAME}`);
    if (!Array.isArray(m.capabilities)) fail(`"capabilities" must be an array`);
    for (const c of m.capabilities as unknown[]) {
        if (typeof c !== "string") fail("capability ids must be strings");
        parseCapability(c as string);
    }
    if (m.priority !== undefined && typeof m.priority !== "number") fail(`"priority" must be a number`);
    const t = m.transport as Record<string, unknown> | undefined;
    if (typeof t !== "object" || t === null) fail(`"transport" must be an object`);
    if (t!.type !== "mcp" && t!.type !== "script" && t!.type !== "mcp-http") {
        fail(`transport.type must be "mcp", "script" or "mcp-http"`);
    }
    // An MCP plugin may contribute agent tools alone; a script plugin is only reachable by capability.
    if (t!.type === "script" && (m.capabilities as unknown[]).length === 0) {
        fail(`"capabilities" must be non-empty for a script transport: nothing else can call it`);
    }
    if (t!.type === "mcp-http") {
        if (typeof t!.url !== "string" || !t!.url.trim()) fail("transport.url must be a non-empty string for mcp-http");
        // Reject process fields rather than ignore them: a manifest that names a command for an
        // HTTP endpoint is a mistake, and silently dropping it hides the mistake.
        for (const key of ["command", "args", "env", "cwd"] as const) {
            if (t![key] !== undefined) fail(`transport.${key} is not used by mcp-http`);
        }
        if (t!.headers !== undefined && !isStringRecord(t!.headers)) fail("transport.headers must map strings to strings");
        if (t!.bearerEnv !== undefined && (typeof t!.bearerEnv !== "string" || !t!.bearerEnv)) {
            fail("transport.bearerEnv must be a non-empty string");
        }
    } else {
        if (typeof t!.command !== "string" || !t!.command) fail("transport.command must be a non-empty string");
        if (t!.args !== undefined && !(Array.isArray(t!.args) && t!.args.every((a) => typeof a === "string"))) fail("transport.args must be an array of strings");
        if (t!.env !== undefined && !isStringRecord(t!.env)) fail("transport.env must map strings to strings");
        if (t!.cwd !== undefined && typeof t!.cwd !== "string") fail("transport.cwd must be a string");
    }
    if ((t!.type === "mcp" || t!.type === "mcp-http") && t!.tools !== undefined) {
        if (!isStringRecord(t!.tools)) fail("transport.tools must map capability ids to tool names");
        for (const c of Object.keys(t!.tools as object)) {
            if (!(m.capabilities as string[]).includes(c)) fail(`transport.tools maps "${c}", which is not in capabilities`);
        }
    }
    if (m.dataSource !== undefined) {
        validateDataSource(m.dataSource, String(t!.type), fail);
    }
    return m as unknown as PluginManifest;
}

function load(manifest: unknown, source: string): LoadedPlugin {
    const m = validateManifest(manifest, source);
    const base = dirname(source);
    const transport = m.transport;
    const relative = transport.type === "mcp-http" ? undefined : transport.cwd;
    const cwd = relative ? (isAbsolute(relative) ? relative : resolve(base, relative)) : base;
    return { manifest: m, source, cwd };
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
        throw new PluginError(`${path}: ${err instanceof Error ? err.message : String(err)}`, { code: "manifest" });
    }
}

/** A JSON file holding one manifest, or `{ "plugins": [manifest, ...] }`. */
function loadFile(path: string): LoadedPlugin[] {
    const raw = readJson(path);
    if (raw && typeof raw === "object" && Array.isArray((raw as { plugins?: unknown }).plugins)) {
        return (raw as { plugins: unknown[] }).plugins.map((m) => load(m, path));
    }
    return [load(raw, path)];
}

/** `dir/plugin.json`, or every `dir/<name>/plugin.json`. */
function loadDir(dir: string): LoadedPlugin[] {
    const own = join(dir, "plugin.json");
    if (existsSync(own)) return loadFile(own);
    return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "plugin.json")))
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((e) => loadFile(join(dir, e.name, "plugin.json")));
}

export interface DiscoverOptions {
    /** Project root holding `plugins/` and `dataclaw.plugins.json`. Default: process.cwd(). */
    root?: string;
    /** Extra manifest files or directories. Default: `DATACLAW_PLUGIN_PATH` split on ":". */
    paths?: readonly string[];
}

/**
 * Find installed plugins, in this order: `<root>/plugins/<name>/plugin.json`,
 * `<root>/dataclaw.plugins.json`, then each entry of `DATACLAW_PLUGIN_PATH`
 * (a manifest file, a plugin directory, or a directory of plugin directories).
 * Duplicate names are an error so a capability never resolves ambiguously by accident.
 */
export function discoverPlugins(options: DiscoverOptions = {}): LoadedPlugin[] {
    const root = options.root ?? process.cwd();
    const extra = options.paths ?? (process.env.DATACLAW_PLUGIN_PATH ?? "").split(":").filter(Boolean);
    const found: LoadedPlugin[] = [];
    if (existsSync(join(root, "plugins"))) found.push(...loadDir(join(root, "plugins")));
    if (existsSync(join(root, "dataclaw.plugins.json"))) found.push(...loadFile(join(root, "dataclaw.plugins.json")));
    for (const entry of extra) {
        const path = resolve(root, entry);
        if (!existsSync(path)) throw new PluginError(`DATACLAW_PLUGIN_PATH entry not found: ${path}`, { code: "manifest" });
        found.push(...(statSync(path).isDirectory() ? loadDir(path) : loadFile(path)));
    }
    const seen = new Map<string, string>();
    for (const p of found) {
        const prior = seen.get(p.manifest.name);
        if (prior) throw new PluginError(`plugin "${p.manifest.name}" is declared twice: ${prior} and ${p.source}`, { code: "manifest" });
        seen.set(p.manifest.name, p.source);
    }
    return found;
}

/**
 * Plugins that provide `capability` (same domain, name and major version), best first:
 * higher `priority`, then name. `prefer` (a plugin name) moves that plugin to the front.
 */
export function providers(plugins: readonly LoadedPlugin[], capability: CapabilityId, prefer?: string): LoadedPlugin[] {
    parseCapability(capability);
    const matches = plugins.filter((p) => p.manifest.capabilities.includes(capability));
    if (prefer && !matches.some((p) => p.manifest.name === prefer)) {
        throw new PluginError(`plugin "${prefer}" does not provide ${capability}`, { code: "manifest" });
    }
    return matches.sort((a, b) => {
        if (prefer) {
            if (a.manifest.name === prefer) return -1;
            if (b.manifest.name === prefer) return 1;
        }
        return (b.manifest.priority ?? 0) - (a.manifest.priority ?? 0) || a.manifest.name.localeCompare(b.manifest.name);
    });
}
