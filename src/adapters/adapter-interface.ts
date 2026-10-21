export interface ColumnProfile {
    name: string;
    type: "INTEGER" | "REAL" | "TEXT";
    nullCount: number;
    nullPct: number;
    distinctCount: number;
    sampleValues: unknown[];
    min?: number | string;
    max?: number | string;
    mean?: number;
    median?: number;
}

export interface DatasetProfile {
    tableName: string;
    rowCount: number;
    columnCount: number;
    columns: ColumnProfile[];
    primaryKeys?: string[];
}

export interface QueryResult {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    executionTimeMs: number;
}

export interface DataAdapter {
    /** Where the data lives: local SQLite/CSV or a remote warehouse. */
    readonly source: "local" | "databricks";
    loadCsv(tableName: string, csvContent: string): Promise<DatasetProfile>;
    loadJson(tableName: string, jsonContent: string): Promise<DatasetProfile>;
    profile(tableName?: string): Promise<DatasetProfile>;
    query(sql: string, maxRows?: number): Promise<QueryResult>;
    calculateMetric(type: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
    close(): Promise<void>;
}
