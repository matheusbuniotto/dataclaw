/**
 * Golden SQL for the two installed dialects. These strings are the contract: the session reads a
 * profile back by the aliases they emit, and a change here changes what every provider sends.
 */
import { describe, expect, test } from "bun:test";
import { ansiDialect, databricksDialect, dialectFor, installedDialects } from "../src/datasource/dialects";
import { quotePart, quoteQualifiedName, splitQuotedName } from "../src/datasource/identifiers";
import { SourceError, type DescribedColumn } from "../src/datasource/types";

function column(name: string, dataType: string): DescribedColumn {
    return { name, dataType, ...databricksDialect.classify(dataType) };
}

describe("identifiers", () => {
    test("quotes a part and doubles an embedded quote", () => {
        expect(quotePart("total", "`")).toBe("`total`");
        expect(quotePart("we`ird", "`")).toBe("`we``ird`");
        expect(quotePart('say "hi"', '"')).toBe('"say ""hi"""');
    });

    test("splits a qualified name and honours a quoted dot", () => {
        expect(splitQuotedName("a.b.c", "`")).toEqual(["a", "b", "c"]);
        expect(splitQuotedName("`my-catalog`.`my.schema`.t", "`")).toEqual(["my-catalog", "my.schema", "t"]);
        expect(quoteQualifiedName("my-catalog.my schema.orders", "`"))
            .toBe("`my-catalog`.`my schema`.`orders`");
    });

    test("refuses an empty part, an unbalanced quote and a statement separator", () => {
        expect(() => splitQuotedName("a..c", "`")).toThrow("empty part");
        expect(() => splitQuotedName("a.`b", "`")).toThrow("Unbalanced");
        expect(() => splitQuotedName("a.b;DROP TABLE c", "`")).toThrow("Invalid identifier part");
    });
});

describe("databricks dialect", () => {
    test("lists the level below a scope", () => {
        expect(databricksDialect.listChildrenSql()).toBe("SHOW CATALOGS");
        expect(databricksDialect.listChildrenSql({ namespace: ["main"] })).toBe("SHOW SCHEMAS IN `main`");
        expect(databricksDialect.listChildrenSql({ namespace: ["main", "default"] }))
            .toBe("SHOW TABLES IN `main`.`default`");
    });

    test("describes with DESCRIBE TABLE and backticks", () => {
        expect(databricksDialect.describeSql("main.default.orders")).toBe("DESCRIBE TABLE `main`.`default`.`orders`");
        expect(databricksDialect.describeSql("my-catalog.my schema.orders"))
            .toBe("DESCRIBE TABLE `my-catalog`.`my schema`.`orders`");
    });

    test("builds the profile aggregate the adapter used to build by hand", () => {
        const sql = databricksDialect.profileSql(
            [column("amount", "DOUBLE"), column("created_at", "TIMESTAMP")],
            "main.default.orders",
        );
        expect(sql).toBe(
            "SELECT COUNT(*) AS `__row_count`, " +
            "COUNT(`amount`) AS `c0__non_null`, COUNT(DISTINCT `amount`) AS `c0__distinct`, " +
            "MIN(CAST(`amount` AS DOUBLE)) AS `c0__min`, MAX(CAST(`amount` AS DOUBLE)) AS `c0__max`, " +
            "AVG(CAST(`amount` AS DOUBLE)) AS `c0__mean`, " +
            "PERCENTILE_APPROX(CAST(`amount` AS DOUBLE), 0.5) AS `c0__median`, " +
            "COUNT(`created_at`) AS `c1__non_null`, COUNT(DISTINCT `created_at`) AS `c1__distinct`, " +
            "MIN(`created_at`) AS `c1__min`, MAX(`created_at`) AS `c1__max` " +
            "FROM `main`.`default`.`orders`",
        );
    });

    test("a text column gets counts and no aggregates", () => {
        const sql = databricksDialect.profileSql([column("name", "STRING")], "main.default.orders");
        expect(sql).toContain("COUNT(`name`) AS `c0__non_null`");
        expect(sql).not.toContain("c0__mean");
        expect(sql).not.toContain("c0__min");
    });

    test("uses the native correlation and percentile functions", () => {
        expect(databricksDialect.correlation("`a`", "`b`"))
            .toBe("CORR(CAST(`a` AS DOUBLE), CAST(`b` AS DOUBLE))");
        expect(databricksDialect.percentile("`a`", 0.25))
            .toBe("PERCENTILE_APPROX(CAST(`a` AS DOUBLE), 0.25)");
    });

    test("classifies Databricks types", () => {
        expect(databricksDialect.classify("BIGINT")).toEqual({ kind: "INTEGER", numeric: true, temporal: false });
        expect(databricksDialect.classify("DECIMAL(10,2)")).toEqual({ kind: "REAL", numeric: true, temporal: false });
        expect(databricksDialect.classify("TIMESTAMP_NTZ")).toEqual({ kind: "TEXT", numeric: false, temporal: true });
        expect(databricksDialect.classify("STRING")).toEqual({ kind: "TEXT", numeric: false, temporal: false });
    });

    test("read-only accepts reads and refuses mutations outside string literals", () => {
        expect(databricksDialect.isReadOnly("SELECT * FROM t")).toBe(true);
        expect(databricksDialect.isReadOnly("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
        expect(databricksDialect.isReadOnly("SELECT 'UPDATE' AS note")).toBe(true);
        expect(databricksDialect.isReadOnly("DROP TABLE t")).toBe(false);
        expect(databricksDialect.isReadOnly("SELECT 1; DELETE FROM t")).toBe(false);
    });
});

describe("ansi dialect", () => {
    test("quotes with double quotes", () => {
        expect(ansiDialect.quote("total")).toBe('"total"');
        expect(ansiDialect.qualify("analytics.public.orders"))
            .toBe('"analytics"."public"."orders"');
    });

    test("discovers through the standard information schema", () => {
        expect(ansiDialect.listChildrenSql())
            .toBe("SELECT DISTINCT catalog_name FROM information_schema.schemata ORDER BY catalog_name");
        expect(ansiDialect.listChildrenSql({ namespace: ["analytics"] }))
            .toBe("SELECT schema_name FROM information_schema.schemata WHERE catalog_name = 'analytics' ORDER BY schema_name");
        expect(ansiDialect.listChildrenSql({ namespace: ["analytics", "public"] }))
            .toBe("SELECT table_name, table_type FROM information_schema.tables WHERE table_catalog = 'analytics' AND table_schema = 'public' ORDER BY table_name");
    });

    test("describes a three-part name with escaped literals", () => {
        expect(ansiDialect.describeSql("analytics.public.orders")).toBe(
            "SELECT column_name, data_type FROM information_schema.columns " +
            "WHERE table_name = 'orders' AND table_schema = 'public' AND table_catalog = 'analytics' " +
            "ORDER BY ordinal_position",
        );
        expect(ansiDialect.describeSql("o'brien.orders")).toContain("table_schema = 'o''brien'");
    });

    test("computes an exact median with PERCENTILE_CONT", () => {
        expect(ansiDialect.percentile('"amount"', 0.5))
            .toBe('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST("amount" AS DOUBLE))');
        expect(ansiDialect.profileSql([column("amount", "DOUBLE")], "analytics.public.orders"))
            .toContain('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST("amount" AS DOUBLE)) AS "c0__median"');
    });
});

describe("dialect registry", () => {
    test("installs ansi and databricks", () => {
        expect(installedDialects().sort()).toEqual(["ansi", "databricks"]);
        expect(dialectFor("databricks")).toBe(databricksDialect);
        expect(dialectFor("ansi")).toBe(ansiDialect);
    });

    test("fails closed for a dialect that has no module yet", () => {
        expect(() => dialectFor("snowflake")).toThrow(SourceError);
        try {
            dialectFor("snowflake");
        } catch (err) {
            expect((err as SourceError).code).toBe("dialect-missing");
            expect((err as SourceError).hint).toContain("snowflake.ts");
        }
    });
});
