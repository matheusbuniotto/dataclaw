/**
 * Where providers come from: Databricks, built in, plus every installed manifest with a
 * `dataSource` block.
 *
 * A manifest declared in `plugins/<name>/plugin.json` becomes a provider, as long as its dialect
 * has a module and its tools match what the server actually publishes. A broken manifest is an
 * error on open, never a crash on list.
 */
import { discoverPlugins } from "../plugins/manifest";
import { openMcpPlugin } from "../plugins/transports";
import type { LoadedPlugin } from "../plugins/types";
import { dialectFor } from "./dialects";
import { translateProviderError } from "./providers/errors";
import { openDatabricksProvider, type DatabricksProviderOptions } from "./providers/databricks";
import { openLocalProvider } from "./providers/local";
import { manifestProvider, verifyProviderTools } from "./providers/manifest";
import { SourceError, type ConnectIntent, type DataProvider } from "./types";
import type { ProviderCatalog, ProviderDescriptor } from "./session";

export interface DataSourceCatalogOptions {
    projectRoot: string;
    /** Plugin ids switched off in `dataclaw.capabilities.json`. */
    disabled?: readonly string[];
    /** Already-discovered plugins. Defaults to discovery under `projectRoot`. */
    plugins?: readonly LoadedPlugin[];
    databricks?: DatabricksProviderOptions;
}

export const LOCAL_PROVIDER: ProviderDescriptor = {
    id: "local",
    kind: "local",
    dialect: "ansi",
    label: "Local files (CSV/JSON)",
};

export const DATABRICKS_PROVIDER: ProviderDescriptor = {
    id: "databricks",
    kind: "remote",
    dialect: "databricks",
    label: "Databricks (Unity Catalog)",
    auth: ["env", "cli-profile", "oauth", "service-principal"],
};

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export class DataSourceCatalog implements ProviderCatalog {
    /** Discovery and validation problems, reported without stopping the catalog. */
    readonly errors: string[] = [];
    private readonly plugins: readonly LoadedPlugin[];

    constructor(private readonly options: DataSourceCatalogOptions) {
        if (options.plugins) {
            this.plugins = [...options.plugins];
            return;
        }
        try {
            this.plugins = discoverPlugins({ root: options.projectRoot });
        } catch (err) {
            this.plugins = [];
            this.errors.push(messageOf(err));
        }
    }

    private dataSourcePlugins(): LoadedPlugin[] {
        return this.plugins.filter((plugin) => plugin.manifest.dataSource !== undefined);
    }

    private isDisabled(name: string): boolean {
        return (this.options.disabled ?? []).includes(`plugin:${name}`);
    }

    list(): ProviderDescriptor[] {
        const manifestProviders = this.dataSourcePlugins()
            .filter((plugin) => !this.isDisabled(plugin.manifest.name))
            .map((plugin): ProviderDescriptor => {
                const spec = plugin.manifest.dataSource!;
                return {
                    id: plugin.manifest.name,
                    kind: "remote",
                    dialect: spec.dialect,
                    label: plugin.manifest.description,
                    ...(spec.auth ? { auth: spec.auth.map((entry) => entry.kind) } : {}),
                };
            });
        return [LOCAL_PROVIDER, DATABRICKS_PROVIDER, ...manifestProviders];
    }

    async open(intent: ConnectIntent): Promise<DataProvider> {
        if (intent.provider === LOCAL_PROVIDER.id) {
            return openLocalProvider();
        }
        if (intent.provider === DATABRICKS_PROVIDER.id) {
            return openDatabricksProvider(intent, this.options.databricks);
        }

        const plugin = this.dataSourcePlugins().find((candidate) => candidate.manifest.name === intent.provider);
        if (!plugin) {
            const known = this.list().map((provider) => provider.id).join(", ");
            throw new SourceError("not-configured", `No data source named "${intent.provider}" is installed.`, {
                provider: intent.provider,
                hint: `Installed data sources: ${known}.`,
            });
        }
        if (this.isDisabled(intent.provider)) {
            throw new SourceError("not-configured", `"${intent.provider}" is switched off.`, {
                provider: intent.provider,
                hint: "Enable it in the capabilities settings.",
            });
        }

        const spec = plugin.manifest.dataSource!;
        const transport = openMcpPlugin(plugin);
        if (!transport) {
            throw new SourceError("not-configured", `"${intent.provider}" is not an MCP plugin.`, {
                provider: intent.provider,
                hint: "A data source needs an mcp or mcp-http transport.",
            });
        }

        try {
            const listed = await transport.listTools();
            verifyProviderTools(spec, listed, intent.provider);
            return manifestProvider(plugin, transport, dialectFor(spec.dialect));
        } catch (err) {
            await transport.close().catch(() => undefined);
            throw translateProviderError(err, intent.provider);
        }
    }
}
