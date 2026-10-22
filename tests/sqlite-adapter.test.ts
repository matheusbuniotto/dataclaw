import { expect, test, describe } from "bun:test";
import { SqliteDataAdapter } from "../src/adapters/sqlite-adapter";

describe("SqliteDataAdapter", () => {
    test("loads CSV and profiles schema", async () => {
        const adapter = await SqliteDataAdapter.create(":memory:");
        const csv = `id,name,amount,active\n1,Alice,100.5,1\n2,Bob,200.0,0\n3,Charlie,,1`;

        const profile = await adapter.loadCsv("users", csv);
        expect(profile.rowCount).toBe(3);
        expect(profile.columnCount).toBe(4);

        const amountCol = profile.columns.find((c) => c.name === "amount");
        expect(amountCol?.nullCount).toBe(1);
        expect(amountCol?.type).toBe("REAL");

        await adapter.close();
    });

    test("executes analytical query and blocks mutation", async () => {
        const adapter = await SqliteDataAdapter.create(":memory:");
        const csv = `tier,score\nBasic,10\nBasic,20\nPro,50`;
        await adapter.loadCsv("data", csv);

        const res = await adapter.query("SELECT tier, AVG(score) as avg_score FROM data GROUP BY tier ORDER BY avg_score DESC");
        expect(res.rowCount).toBe(2);
        expect(res.rows[0]?.tier).toBe("Pro");
        expect(res.rows[0]?.avg_score).toBe(50);

        // Blocks non-SELECT
        expect(adapter.query("DROP TABLE data")).rejects.toThrow();

        await adapter.close();
    });

    test("calculates Pearson correlation accurately", async () => {
        const adapter = await SqliteDataAdapter.create(":memory:");
        // Perfect positive correlation: y = 2x
        const csv = `x,y\n1,2\n2,4\n3,6\n4,8\n5,10`;
        await adapter.loadCsv("metrics", csv);

        const corr = await adapter.calculateMetric("correlation", {
            colA: "x",
            colB: "y",
            tableName: "metrics",
        });

        expect(corr.correlation).toBe(1.0);
        expect(corr.strength).toBe("strong");
        expect(corr.direction).toBe("positive");

        await adapter.close();
    });
});
