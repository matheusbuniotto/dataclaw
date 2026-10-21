/**
 * Identifier quoting and splitting, shared by every dialect.
 *
 * Conservative on purpose: a part containing the quote character, a control character or a
 * statement separator is refused rather than escaped into something a warehouse might read
 * differently. An identifier with a literal quote in it is not worth supporting in an analytical
 * agent; refusing it is.
 */

function inCharacterClass(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Quote one part, doubling any embedded quote character. */
export function quotePart(identifier: string, quote: string): string {
    return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`;
}

/**
 * Split `catalog.schema.table`, honouring quoted parts (`` `my.schema`.t ``). Rejects empty parts,
 * unbalanced quotes, control characters and `;`.
 */
export function splitQuotedName(input: string, quote: string): string[] {
    const name = input.trim();
    if (!name) throw new Error("Identifier must not be empty.");

    const parts: string[] = [];
    let current = "";
    let quoted = false;

    for (const char of name) {
        if (char === quote) {
            quoted = !quoted;
            current += char;
            continue;
        }
        if (char === "." && !quoted) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    parts.push(current);

    if (quoted) throw new Error(`Unbalanced ${quote} in identifier: ${name}`);

    const unsafe = new RegExp(`[${inCharacterClass(quote)}\\u0000-\\u001f;]`);
    return parts.map((part) => {
        const trimmed = part.trim();
        if (!trimmed) throw new Error(`Invalid qualified name "${name}": empty part.`);
        const unquoted = trimmed.length >= 2 && trimmed.startsWith(quote) && trimmed.endsWith(quote)
            ? trimmed.slice(1, -1).split(quote + quote).join(quote)
            : trimmed;
        if (!unquoted || unsafe.test(unquoted)) {
            throw new Error(`Invalid identifier part "${part}" in "${name}".`);
        }
        return unquoted;
    });
}

/** Split and re-quote every part: `a.b` becomes `` `a`.`b` ``. */
export function quoteQualifiedName(name: string, quote: string): string {
    return splitQuotedName(name, quote).map((part) => quotePart(part, quote)).join(".");
}
