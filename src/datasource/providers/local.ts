/**
 * Local CSV/JSON as a data source: an in-memory SQLite database behind the provider port.
 *
 * It is the only provider with `intake`, which is why loading a file is a capability rather than a
 * method every remote source has to refuse. Discovery, describe and profile are native: SQLite knows
 * its own tables and the adapter already profiles them.
 */
import type { DatasetProfile, QueryResult } from "../../adapters/adapter-interface";
import { SqliteDataAdapter } from "../../adapters/sqlite-adapter";
import { ansiDialect } from "../dialects";
import {
    SourceError,
    type DataProvider,
    type DatasetIntake,
    type DescribedColumn,
    type Discovery,
} from "../types";
import { translateProviderError } from "./errors";

export interface LocalProviderOptions {
    /** Injected by tests; a fresh in-memory database otherwise. */
    adapter?: SqliteDataAdapter;
}

export async function openLocalProvider(options: LocalProviderOptions = {}): Promise<DataProvider> {
    const adapter = options.adapter ?? await SqliteDataAdapter.create(":memory:");

    const intake: DatasetIntake = {
        loadCsv: (table, content) => adapter.loadCsv(table, content),
        loadJson: (table, content) => adapter.loadJson(table, content),
    };

    return {
        id: "local",
        kind: "local",
        dialect: ansiDialect,
        intake,

        async probe() {
            return { tools: [], readOnly: "checked" as const };
        },

        async execute(sql: string, executeOptions = {}): Promise<QueryResult> {
            if (!ansiDialect.isReadOnly(sql)) {
                throw new SourceError("read-only-violation", "Only read-only SQL is permitted.", {
                    provider: "local",
                    hint: "Local datasets are read-only; load a file and query it.",
                });
            }
            if (executeOptions.signal?.aborted) throw new SourceError("aborted", "Stopped.", { provider: "local" });
            try {
                return await adapter.query(sql, executeOptions.maxRows ?? 200);
            } catch (err) {
                throw translateProviderError(err, "local");
            }
        },

        async inventory(): Promise<Discovery[]> {
            const result: QueryResult = await adapter.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            );
            return result.rows.flatMap((row) =>
                typeof row.name === "string" ? [{ name: row.name, kind: "dataset" as const }] : []);
        },

        async describe(dataset: string): Promise<DescribedColumn[]> {
            const result = await adapter.query(`PRAGMA table_info(${ansiDialect.quote(dataset)})`);
            return result.rows.flatMap((row) => {
                if (typeof row.name !== "string") return [];
                const dataType = String(row.type ?? "TEXT") || "TEXT";
                return [{ name: row.name, dataType, ...ansiDialect.classify(dataType) }];
            });
        },

        async profile(dataset: string): Promise<DatasetProfile> {
            try {
                return await adapter.profile(dataset);
            } catch (err) {
                throw translateProviderError(err, "local");
            }
        },

        async close() {
            await adapter.close();
        },
    };
}
