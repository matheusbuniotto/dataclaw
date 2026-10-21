/**
 * Adopt a `DataAdapter` a host already opened as a `DataProvider`.
 *
 * The console's Databricks auth panel owns its own connection (OAuth refresh, a status object, a
 * live catalog list). Rather than open a second one, it hands the adapter over and the session
 * records it like any other source. Nothing else uses this bridge.
 */
import type { DataAdapter } from "../../adapters/adapter-interface";
import type { DataProvider, DatasetIntake, DescribedColumn, Dialect } from "../types";

interface DescribesTables {
    describeTable?(table: string): Promise<DescribedColumn[]>;
}

export function bridgedProvider(id: string, dialect: Dialect, adapter: DataAdapter): DataProvider {
    const local = adapter.source === "local";
    const describes = (adapter as DataAdapter & DescribesTables).describeTable;
    const intake: DatasetIntake = {
        loadCsv: (table, content) => adapter.loadCsv(table, content),
        loadJson: (table, content) => adapter.loadJson(table, content),
    };

    return {
        id,
        kind: local ? "local" : "remote",
        dialect,
        ...(local ? { intake } : {}),

        async probe() {
            return { tools: [], readOnly: "checked" as const };
        },

        async execute(sql: string, options = {}) {
            return adapter.query(sql, options.maxRows ?? 200);
        },

        ...(typeof describes === "function"
            ? { describe: (dataset: string) => describes.call(adapter, dataset) }
            : {}),

        async profile(dataset: string) {
            return adapter.profile(dataset);
        },

        async close() {
            await adapter.close();
        },
    };
}
