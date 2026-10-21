import type { DescribedColumn } from "../types";

/** What the shared profile builder needs from a dialect. */
export interface ProfileHelpers {
    quote(identifier: string): string;
    qualify(dataset: string): string;
    castDouble(expression: string): string;
    percentile(expression: string, p: number): string;
}

/**
 * One aggregate statement profiling `dataset`.
 *
 * The aliases are part of the dialect contract: the session reads `__row_count` and the
 * `c{i}__*` family back, so every dialect emits the same names and the readback does not care
 * which SQL function produced the number.
 */
export function profileAggregateSql(
    columns: readonly DescribedColumn[],
    dataset: string,
    helpers: ProfileHelpers,
): string {
    const parts = [`COUNT(*) AS ${helpers.quote("__row_count")}`];

    columns.forEach((column, index) => {
        const id = helpers.quote(column.name);
        parts.push(`COUNT(${id}) AS ${helpers.quote(`c${index}__non_null`)}`);
        parts.push(`COUNT(DISTINCT ${id}) AS ${helpers.quote(`c${index}__distinct`)}`);

        if (column.numeric) {
            parts.push(`MIN(${helpers.castDouble(id)}) AS ${helpers.quote(`c${index}__min`)}`);
            parts.push(`MAX(${helpers.castDouble(id)}) AS ${helpers.quote(`c${index}__max`)}`);
            parts.push(`AVG(${helpers.castDouble(id)}) AS ${helpers.quote(`c${index}__mean`)}`);
            parts.push(`${helpers.percentile(id, 0.5)} AS ${helpers.quote(`c${index}__median`)}`);
        } else if (column.temporal) {
            parts.push(`MIN(${id}) AS ${helpers.quote(`c${index}__min`)}`);
            parts.push(`MAX(${id}) AS ${helpers.quote(`c${index}__max`)}`);
        }
    });

    return `SELECT ${parts.join(", ")} FROM ${helpers.qualify(dataset)}`;
}
