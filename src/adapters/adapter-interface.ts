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

export type CorrelationMetricOptions = {
    readonly colA: string;
    readonly colB: string;
    readonly tableName?: string;
};

export type PercentilesMetricOptions = {
    readonly col?: string;
    readonly colA?: string;
    readonly tableName?: string;
};

export type CorrelationResult =
    | {
          readonly metric: "pearson_correlation";
          readonly columns: readonly [string, string];
          readonly sampleSize: number;
          readonly correlation: number;
          readonly strength: "strong" | "moderate" | "weak";
          readonly direction: "positive" | "negative";
      }
    | {
          readonly correlation: 0;
          readonly sampleSize: number;
          readonly note: string;
          readonly strength?: undefined;
          readonly direction?: undefined;
      };

export type PercentilesResult =
    | {
          readonly column: string;
          readonly count: number;
          readonly p25?: number;
          readonly p50_median?: number;
          readonly p75?: number;
          readonly p90?: number;
          readonly p99?: number;
          readonly error?: undefined;
      }
    | {
          readonly error: string;
          readonly column?: undefined;
          readonly count?: undefined;
          readonly p25?: undefined;
          readonly p50_median?: undefined;
          readonly p75?: undefined;
          readonly p90?: undefined;
          readonly p99?: undefined;
      };

export interface DataAdapter {
    /** Where the data lives: local SQLite/CSV, Databricks Unity Catalog, or Databricks Lakehouse PostgreSQL. */
    readonly source: "local" | "databricks" | "lakehouse-postgres";
    loadCsv(tableName: string, csvContent: string): Promise<DatasetProfile>;
    loadJson(tableName: string, jsonContent: string): Promise<DatasetProfile>;
    profile(tableName?: string): Promise<DatasetProfile>;
    query(sql: string, maxRows?: number): Promise<QueryResult>;
    calculateMetric(type: "correlation", options: CorrelationMetricOptions): Promise<CorrelationResult>;
    calculateMetric(type: "percentiles", options: PercentilesMetricOptions): Promise<PercentilesResult>;
    calculateMetric(type: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
    close(): Promise<void>;
}
