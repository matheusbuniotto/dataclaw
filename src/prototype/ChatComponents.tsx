import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked, type Tokens } from "marked";
import { declaredCategory, toolDeclaration, type ToolCategory } from "../tools/inventory";
import type { ToolInvocation, TranscriptItem } from "./workspace-types";
import {
    AlertCircle,
    AlertTriangle,
    BookOpen,
    BrainCircuit,
    Check,
    ChevronDown,
    ChevronRight,
    Code2,
    Copy,
    Database,
    ExternalLink,
    FileCode,
    Flame,
    Info,
    Loader2,
    ShieldCheck,
    Sparkles,
    Table,
    Terminal,
    Wrench,
    XCircle,
} from "lucide-react";

// ============================================================================
// Clipboard helper
// ============================================================================
export function useClipboard() {
    const [copied, setCopied] = useState(false);
    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
            const el = document.createElement("textarea");
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };
    return { copied, copy };
}

// ============================================================================
// Syntax Highlighter (Lightweight, pure regex tokenization)
// ============================================================================
export function highlightCode(code: string, lang = ""): React.ReactNode {
    const language = lang.toLowerCase().trim();

    if (language === "sql") {
        const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|IN|IS|NULL|TRUE|FALSE|CASE|WHEN|THEN|ELSE|END|COUNT|AVG|SUM|MIN|MAX|DISTINCT|SHOW|CATALOGS|SCHEMAS|TABLES|DESCRIBE|USE|CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|VIEW|SET|UNION|ALL|LIKE|ILIKE|BETWEEN|EXISTS)\b/gi;
        const strings = /('(?:''|[^'])*')/g;
        const comments = /(--.*$|\/\*[\s\S]*?\*\/)/gm;
        const numbers = /\b(\d+(?:\.\d+)?)\b/g;

        const tokens: Array<{ type: string; text: string }> = [];
        let lastIndex = 0;
        const combined = new RegExp(`${comments.source}|${strings.source}|${keywords.source}|${numbers.source}`, "gim");
        let m: RegExpExecArray | null;

        while ((m = combined.exec(code)) !== null) {
            if (m.index > lastIndex) {
                tokens.push({ type: "plain", text: code.slice(lastIndex, m.index) });
            }
            if (m[1]) tokens.push({ type: "comment", text: m[1] });
            else if (m[2]) tokens.push({ type: "string", text: m[2] });
            else if (m[3]) tokens.push({ type: "keyword", text: m[3] });
            else if (m[4]) tokens.push({ type: "number", text: m[4] });
            lastIndex = combined.lastIndex;
        }
        if (lastIndex < code.length) {
            tokens.push({ type: "plain", text: code.slice(lastIndex) });
        }

        return tokens.map((tok, i) => {
            if (tok.type === "keyword") return <span key={i} className="syntax-keyword">{tok.text}</span>;
            if (tok.type === "string") return <span key={i} className="syntax-string">{tok.text}</span>;
            if (tok.type === "comment") return <span key={i} className="syntax-comment">{tok.text}</span>;
            if (tok.type === "number") return <span key={i} className="syntax-number">{tok.text}</span>;
            return tok.text;
        });
    }

    if (language === "json") {
        const jsonKeys = /("(?:\\.|[^"\\])*")(?=\s*:)/g;
        const jsonStrings = /:\s*("(?:\\.|[^"\\])*")/g;
        const jsonNumbers = /\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;
        const jsonBools = /\b(true|false|null)\b/g;

        const tokens: Array<{ type: string; text: string }> = [];
        let lastIndex = 0;
        const combined = new RegExp(`(?:"(?:\\\\.|[^"\\\\])*"(?=\\s*:))|(?:(?<=:\\s*)"(?:\\\\.|[^"\\\\])*")|\\b(?:true|false|null)\\b|\\b-?\\d+(?:\\.\\d+)?\\b`, "g");
        let m: RegExpExecArray | null;

        while ((m = combined.exec(code)) !== null) {
            if (m.index > lastIndex) {
                tokens.push({ type: "plain", text: code.slice(lastIndex, m.index) });
            }
            const match = m[0];
            if (match.startsWith('"') && code[m.index + match.length] === ":") {
                tokens.push({ type: "key", text: match });
            } else if (match.startsWith('"')) {
                tokens.push({ type: "string", text: match });
            } else if (match === "true" || match === "false" || match === "null") {
                tokens.push({ type: "keyword", text: match });
            } else {
                tokens.push({ type: "number", text: match });
            }
            lastIndex = combined.lastIndex;
        }
        if (lastIndex < code.length) {
            tokens.push({ type: "plain", text: code.slice(lastIndex) });
        }

        return tokens.map((tok, i) => {
            if (tok.type === "key") return <span key={i} className="syntax-key">{tok.text}</span>;
            if (tok.type === "string") return <span key={i} className="syntax-string">{tok.text}</span>;
            if (tok.type === "keyword") return <span key={i} className="syntax-keyword">{tok.text}</span>;
            if (tok.type === "number") return <span key={i} className="syntax-number">{tok.text}</span>;
            return tok.text;
        });
    }

    if (language === "bash" || language === "sh" || language === "shell") {
        const comments = /(#.*$)/gm;
        const strings = /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g;
        const vars = /(\$[A-Za-z0-9_]+|\$\{[A-Za-z0-9_]+\})/g;
        const flags = /(--?[a-zA-Z0-9_-]+)/g;

        const tokens: Array<{ type: string; text: string }> = [];
        let lastIndex = 0;
        const combined = new RegExp(`${comments.source}|${strings.source}|${vars.source}|${flags.source}`, "gm");
        let m: RegExpExecArray | null;

        while ((m = combined.exec(code)) !== null) {
            if (m.index > lastIndex) {
                tokens.push({ type: "plain", text: code.slice(lastIndex, m.index) });
            }
            if (m[1]) tokens.push({ type: "comment", text: m[1] });
            else if (m[2]) tokens.push({ type: "string", text: m[2] });
            else if (m[3]) tokens.push({ type: "var", text: m[3] });
            else if (m[4]) tokens.push({ type: "flag", text: m[4] });
            lastIndex = combined.lastIndex;
        }
        if (lastIndex < code.length) {
            tokens.push({ type: "plain", text: code.slice(lastIndex) });
        }

        return tokens.map((tok, i) => {
            if (tok.type === "comment") return <span key={i} className="syntax-comment">{tok.text}</span>;
            if (tok.type === "string") return <span key={i} className="syntax-string">{tok.text}</span>;
            if (tok.type === "var") return <span key={i} className="syntax-key">{tok.text}</span>;
            if (tok.type === "flag") return <span key={i} className="syntax-number">{tok.text}</span>;
            return tok.text;
        });
    }

    return code;
}

// ============================================================================
// CodeBlock with Header, Language Badge, and Copy
// ============================================================================
export function CodeBlock({ code, lang = "", title }: { code: string; lang?: string; title?: string }) {
    const { copied, copy } = useClipboard();
    const displayLang = (lang || (code.trim().startsWith("{") ? "json" : "text")).toLowerCase();
    const cleanCode = code.replace(/\n$/, "");

    return (
        <div className="chat-code-block">
            <div className="chat-code-header">
                <div className="chat-code-title">
                    <Code2 size={13} />
                    <span>{title || displayLang.toUpperCase()}</span>
                </div>
                <button
                    className="chat-code-copy-btn"
                    onClick={() => copy(cleanCode)}
                    aria-label="Copy code"
                    title="Copy to clipboard"
                >
                    {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                </button>
            </div>
            <pre className="chat-code-pre">
                <code>{highlightCode(cleanCode, displayLang)}</code>
            </pre>
        </div>
    );
}

// ============================================================================
// Tabular ASCII/Pipe output parser & renderer
// ============================================================================
interface ParsedTable {
    headers: string[];
    rows: string[][];
    rowCountNote?: string;
}

export function parseTabularOutput(text: string): ParsedTable | null {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;

    // Check if there is a header divider like ---+--- or |---|
    let divIndex = -1;
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
        if (/^[\s\-+|:]+$/.test(lines[i]) && (lines[i].includes("+") || lines[i].includes("-") || lines[i].includes("|"))) {
            divIndex = i;
            break;
        }
    }

    if (divIndex <= 0) return null;

    const headerLine = lines[divIndex - 1];
    const separator = headerLine.includes("|") ? "|" : /\s{2,}/;
    const headers = headerLine.split(separator).map((s) => s.trim()).filter(Boolean);
    if (headers.length < 2) return null;

    const rows: string[][] = [];
    let rowCountNote: string | undefined;

    for (let i = divIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (/^\(\d+\s+rows?\)/i.test(line)) {
            rowCountNote = line;
            continue;
        }
        if (/^[\s\-+|:]+$/.test(line)) continue;

        const cells = line.split(separator).map((s) => s.trim());
        if (cells.length >= headers.length) {
            rows.push(cells.slice(0, headers.length));
        } else if (cells.length > 0 && cells[0]) {
            // pad
            while (cells.length < headers.length) cells.push("");
            rows.push(cells);
        }
    }

    if (rows.length === 0) return null;
    return { headers, rows, rowCountNote };
}

export function TabularOutputView({ text }: { text: string }) {
    const [viewRaw, setViewRaw] = useState(false);
    const parsed = useMemo(() => parseTabularOutput(text), [text]);
    const { copied, copy } = useClipboard();

    if (!parsed || viewRaw) {
        return (
            <div className="chat-tabular-wrap">
                {parsed && (
                    <div className="chat-tabular-toolbar">
                        <button className="button-quiet text-xs" onClick={() => setViewRaw(false)}>
                            Show as table
                        </button>
                    </div>
                )}
                <pre className="chat-code-pre">{text}</pre>
            </div>
        );
    }

    const tsvContent = [
        parsed.headers.join("\t"),
        ...parsed.rows.map((r) => r.join("\t")),
    ].join("\n");

    return (
        <div className="chat-tabular-wrap">
            <div className="chat-tabular-toolbar">
                <div className="chat-tabular-meta">
                    <Table size={12} />
                    <span>{parsed.rowCountNote || `${parsed.rows.length} rows`}</span>
                </div>
                <div className="chat-tabular-actions">
                    <button
                        className="chat-code-copy-btn"
                        onClick={() => copy(tsvContent)}
                        title="Copy as TSV"
                    >
                        {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                        <span>{copied ? "Copied" : "Copy TSV"}</span>
                    </button>
                    <button className="chat-code-copy-btn" onClick={() => setViewRaw(true)}>
                        Raw
                    </button>
                </div>
            </div>
            <div className="chat-table-scroll">
                <table className="chat-markdown-table">
                    <thead>
                        <tr>
                            {parsed.headers.map((h, i) => (
                                <th key={i}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsed.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                    <td key={cIdx}>{cell}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ============================================================================
// Markdown Renderer (Headings, Paragraphs, Code, Tables, Alerts, Lists)
// ============================================================================
export function renderInlineTokens(tokens?: Tokens.Inline[]): React.ReactNode {
    if (!tokens) return null;
    return tokens.map((token, i) => {
        switch (token.type) {
            case "text":
                return token.text;
            case "strong":
                return <strong key={i}>{renderInlineTokens(token.tokens)}</strong>;
            case "em":
                return <em key={i}>{renderInlineTokens(token.tokens)}</em>;
            case "del":
                return <del key={i}>{renderInlineTokens(token.tokens)}</del>;
            case "codespan":
                return (
                    <code key={i} className="chat-inline-code">
                        {token.text}
                    </code>
                );
            case "link":
                return (
                    <a
                        key={i}
                        href={token.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-markdown-link"
                    >
                        {renderInlineTokens(token.tokens)}
                        <ExternalLink size={10} className="inline-block ml-0.5 opacity-60" />
                    </a>
                );
            case "br":
                return <br key={i} />;
            case "image":
                return (
                    <img
                        key={i}
                        src={token.href}
                        alt={token.text}
                        className="chat-inline-image"
                    />
                );
            case "escape":
                return token.text;
            default:
                return "text" in token ? (token as { text: string }).text : null;
        }
    });
}

function AlertBlock({ type, children }: { type: string; children: React.ReactNode }) {
    const alertType = type.toLowerCase();
    let icon = <Info size={15} />;
    let badgeClass = "chat-alert-info";
    let title = "Note";

    if (alertType === "tip") {
        icon = <Sparkles size={15} />;
        badgeClass = "chat-alert-tip";
        title = "Tip";
    } else if (alertType === "important") {
        icon = <AlertCircle size={15} />;
        badgeClass = "chat-alert-important";
        title = "Important";
    } else if (alertType === "warning") {
        icon = <AlertTriangle size={15} />;
        badgeClass = "chat-alert-warning";
        title = "Warning";
    } else if (alertType === "caution") {
        icon = <Flame size={15} />;
        badgeClass = "chat-alert-caution";
        title = "Caution";
    }

    return (
        <div className={`chat-alert-card ${badgeClass}`}>
            <div className="chat-alert-head">
                {icon}
                <span className="font-semibold">{title}</span>
            </div>
            <div className="chat-alert-body">{children}</div>
        </div>
    );
}

function MarkdownTable({ token }: { token: Tokens.Table }) {
    const { copy, copied } = useClipboard();
    const tsv = [
        token.header.map((h) => h.text).join("\t"),
        ...token.rows.map((row) => row.map((c) => c.text).join("\t")),
    ].join("\n");

    return (
        <div className="chat-tabular-wrap">
            <div className="chat-tabular-toolbar">
                <div className="chat-tabular-meta">
                    <Table size={12} />
                    <span>{token.rows.length} rows</span>
                </div>
                <button className="chat-code-copy-btn" onClick={() => copy(tsv)} title="Copy as TSV" type="button">
                    {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copied ? "Copied" : "Copy TSV"}</span>
                </button>
            </div>
            <div className="chat-table-scroll">
                <table className="chat-markdown-table">
                    <thead>
                        <tr>
                            {token.header.map((col, cIdx) => (
                                <th key={cIdx} style={col.align ? { textAlign: col.align } : undefined}>
                                    {renderInlineTokens(col.tokens)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {token.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                    <td
                                        key={cIdx}
                                        style={token.align[cIdx] ? { textAlign: token.align[cIdx]! } : undefined}
                                    >
                                        {renderInlineTokens(cell.tokens)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function MarkdownView({ content }: { content: string }) {
    const tokens = useMemo(() => {
        try {
            return marked.lexer(content);
        } catch {
            return [];
        }
    }, [content]);

    if (!tokens || tokens.length === 0) {
        return <div className="chat-text-plain">{content}</div>;
    }

    return (
        <div className="chat-markdown-body">
            {tokens.map((token, idx) => {
                switch (token.type) {
                    case "heading": {
                        const Tag = `h${Math.min(6, Math.max(1, token.depth))}` as keyof JSX.IntrinsicElements;
                        return (
                            <Tag key={idx} className={`chat-heading chat-h${token.depth}`}>
                                {renderInlineTokens(token.tokens)}
                            </Tag>
                        );
                    }
                    case "paragraph":
                        return (
                            <p key={idx} className="chat-p">
                                {renderInlineTokens(token.tokens)}
                            </p>
                        );
                    case "code":
                        return <CodeBlock key={idx} code={token.text} lang={token.lang} />;
                    case "table":
                        return <MarkdownTable key={idx} token={token} />;
                    case "blockquote": {
                        const rawText = token.text || "";
                        const alertMatch = rawText.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/im);
                        if (alertMatch) {
                            const alertType = alertMatch[1]!;
                            const remaining = rawText.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/im, "");
                            return (
                                <AlertBlock key={idx} type={alertType}>
                                    <MarkdownView content={remaining} />
                                </AlertBlock>
                            );
                        }
                        return (
                            <blockquote key={idx} className="chat-blockquote">
                                {token.tokens ? (
                                    token.tokens.map((t, i) =>
                                        t.type === "paragraph" ? (
                                            <p key={i}>{renderInlineTokens(t.tokens)}</p>
                                        ) : (
                                            <span key={i}>{t.raw}</span>
                                        )
                                    )
                                ) : (
                                    <p>{rawText}</p>
                                )}
                            </blockquote>
                        );
                    }
                    case "list": {
                        const ListTag = token.ordered ? "ol" : "ul";
                        return (
                            <ListTag
                                key={idx}
                                className={token.ordered ? "chat-list-ordered" : "chat-list-unordered"}
                            >
                                {token.items.map((item, itemIdx) => (
                                    <li
                                        key={itemIdx}
                                        className={item.task ? "chat-list-task-item" : "chat-list-item"}
                                    >
                                        {item.task && (
                                            <span className="chat-task-checkbox">
                                                {item.checked ? (
                                                    <Check size={12} className="text-emerald-600 font-bold" />
                                                ) : (
                                                    <span className="chat-checkbox-blank" />
                                                )}
                                            </span>
                                        )}
                                        <div className="chat-list-content">
                                            {item.tokens ? (
                                                item.tokens.map((itTok, itIdx) => {
                                                    if (itTok.type === "text") {
                                                        return (
                                                            <span key={itIdx}>
                                                                {renderInlineTokens(itTok.tokens || [{ type: "text", raw: itTok.text, text: itTok.text, escaped: false }])}
                                                            </span>
                                                        );
                                                    }
                                                    if (itTok.type === "paragraph") {
                                                        return <p key={itIdx}>{renderInlineTokens(itTok.tokens)}</p>;
                                                    }
                                                    return <span key={itIdx}>{itTok.raw}</span>;
                                                })
                                            ) : (
                                                item.text
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ListTag>
                        );
                    }
                    case "hr":
                        return <hr key={idx} className="chat-hr" />;
                    case "space":
                        return null;
                    default:
                        return (
                            <div key={idx} className="chat-raw-token">
                                {token.raw}
                            </div>
                        );
                }
            })}
        </div>
    );
}

// ============================================================================
// Thinking
// ============================================================================
export function ThinkingView({ text, active = false }: { text: string; active?: boolean }) {
    const [open, setOpen] = useState(active);
    const wasActive = useRef(active);
    useEffect(() => {
        if (wasActive.current === active) return;
        wasActive.current = active;
        setOpen(active);
    }, [active]);

    const flat = text.replace(/\s+/g, " ").trim();
    const snippet = flat.length > 96 ? `${flat.slice(0, 96)}…` : flat;
    const lineCount = text.split("\n").length;

    return (
        <div className={`chat-thinking-wrap${active ? " is-active" : ""}`}>
            <button
                className={`chat-thinking-header${active ? " is-active" : ""}`}
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                type="button"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="chat-thinking-icon">
                        {active ? <Loader2 size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                    </span>
                    <span className="chat-thinking-title">{active ? "Thinking" : "Thought"}</span>
                    {!open && snippet && <span className="chat-thinking-snippet">· {snippet}</span>}
                </div>
                <div className="flex items-center gap-2">
                    <span className="chat-thinking-lines">{lineCount === 1 ? "1 line" : `${lineCount} lines`}</span>
                    <ChevronDown
                        size={12}
                        className={`chat-chevron transition-transform ${open ? "rotate-180" : ""}`}
                    />
                </div>
            </button>
            {open && (
                <div className="chat-thinking-body">
                    <div className="chat-thinking-prose">{text}</div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Tool Invocation Card (Tooling execution)
// ============================================================================
// Phrases and categories come from the declaration in src/tools/inventory.ts; an undeclared
// tool (a plugin's, or a name that is not installed here) falls back to its own name.
const CATEGORY_LOOK: Record<ToolCategory, { icon: React.ReactNode; colorClass: string }> = {
    db: { icon: <Database size={13} />, colorClass: "tool-color-db" },
    terminal: { icon: <Terminal size={13} />, colorClass: "tool-color-bash" },
    file: { icon: <FileCode size={13} />, colorClass: "tool-color-file" },
    audit: { icon: <ShieldCheck size={13} />, colorClass: "tool-color-audit" },
    other: { icon: <Wrench size={13} />, colorClass: "tool-color-other" },
};

export function toolCategory(name: string): {
    icon: React.ReactNode;
    category: ToolCategory;
    colorClass: string;
    calling: string;
    called: string;
} {
    const declared = toolDeclaration(name);
    const category = declaredCategory(name);
    const words = name.toLowerCase().replace(/_/g, " ");
    const phrase = declared?.phrase ?? { calling: `Calling ${words}`, called: words };
    return { icon: CATEGORY_LOOK[category].icon, category, colorClass: CATEGORY_LOOK[category].colorClass, ...phrase };
}

function argsRecordOf(args: unknown): Record<string, unknown> | null {
    return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
}

function argText(args: Record<string, unknown> | null, key: string): string | null {
    const value = args?.[key];
    return typeof value === "string" && value.trim() ? value : null;
}

function isInstructionPath(path: string): boolean {
    return /(?:^|\/)(SKILL|AGENTS|SOUL|IDENTITY|USER|CLAUDE)\.md$/i.test(path);
}

function formatDuration(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function cleanToolResult(text: string): { error: boolean; body: string } {
    const stripped = text.replace(/^<harness>\s*\[error\]\s*/i, "").trim();
    const error = stripped !== text.trim() || /^failed\b/i.test(stripped) || /^error:/i.test(stripped);
    return { error, body: stripped || text };
}

function ToolResultView({ text, failed }: { text: string; failed: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const cleaned = cleanToolResult(text);
    const isError = failed || cleaned.error;
    const limit = 1600;
    const tabular = !isError && Boolean(parseTabularOutput(cleaned.body));
    let pretty = cleaned.body;
    let lang = "";
    if (!isError && !tabular && /^[[{]/.test(cleaned.body.trim())) {
        try {
            pretty = JSON.stringify(JSON.parse(cleaned.body), null, 2);
            lang = "json";
        } catch {
            pretty = cleaned.body;
        }
    }
    const clipped = !expanded && !isError && !tabular && pretty.length > limit;
    const shown = clipped ? `${pretty.slice(0, limit).trimEnd()}…` : pretty;

    let body: React.ReactNode;
    if (isError) body = <pre className="tool-result-error">{cleaned.body}</pre>;
    else if (tabular) body = <TabularOutputView text={cleaned.body} />;
    else if (lang) body = <CodeBlock code={shown} lang="json" title="JSON" />;
    else body = <pre className="tool-result-plain">{shown}</pre>;

    return (
        <div className="tool-section">
            <div className="tool-section-head">
                <span className="tool-section-label">{isError ? "Error" : "Result"}</span>
            </div>
            {body}
            {clipped && (
                <button className="tool-more" type="button" onClick={() => setExpanded(true)}>
                    Show full result
                </button>
            )}
        </div>
    );
}

export function ToolInvocationCard({
    tool,
    defaultOpen = false,
}: {
    tool: ToolInvocation;
    defaultOpen?: boolean;
}) {
    const meta = toolCategory(tool.toolName);
    const args = argsRecordOf(tool.args);
    const sql = argText(args, "sql");
    const command = argText(args, "command");
    const path = argText(args, "path") ?? argText(args, "filePath");
    const instruction = argText(args, "instruction") ?? argText(args, "instructions") ?? argText(args, "rationale");
    const instructionFile = Boolean(path && isInstructionPath(path) && (tool.toolName === "read" || tool.toolName === "write" || tool.toolName === "edit"));
    const isSyntheticUnavailable = Boolean(tool.resultText?.includes("Tool result unavailable: history ends before this call completed."));
    const isRunning = tool.status === "running" || isSyntheticUnavailable;
    const failed = !isSyntheticUnavailable && (Boolean(tool.isError) || tool.status === "error" || Boolean(tool.resultText?.includes("<harness>\n[error]")));
    const [open, setOpen] = useState(defaultOpen || isRunning || failed);
    const previousStatus = useRef(tool.status);

    useEffect(() => {
        if (previousStatus.current === tool.status) return;
        const previous = previousStatus.current;
        previousStatus.current = tool.status;
        if (isRunning || tool.status === "error") setOpen(true);
        else if (previous === "running" && tool.status === "completed") setOpen(false);
    }, [tool.status, isRunning]);

    const instructionPhrase = tool.toolName === "write"
        ? { calling: "Writing instructions", called: "Wrote instructions" }
        : tool.toolName === "edit"
            ? { calling: "Editing instructions", called: "Edited instructions" }
            : { calling: "Reading instructions", called: "Read instructions" };
    const phrase = instructionFile ? instructionPhrase : meta;
    const title = isRunning ? phrase.calling : phrase.called;
    const summary = tool.summary && tool.summary !== tool.toolName ? tool.summary : "";

    const hiddenKeys = new Set(["sql", "command", "path", "filePath", "rationale", "instruction", "instructions"]);
    const rest = args
        ? Object.entries(args).filter(([key, value]) => !hiddenKeys.has(key) && value !== undefined && value !== "")
        : [];

    return (
        <div className={`tool-card ${tool.status} ${meta.colorClass}${isRunning ? " is-running" : ""}${failed ? " is-error" : ""}`}>
            <div
                className="tool-card-head"
                onClick={() => setOpen(!open)}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen(!open);
                    }
                }}
            >
                <div className="tool-card-left">
                    <span className="tool-card-glyph">{instructionFile ? <BookOpen size={13} /> : meta.icon}</span>
                    <span className="tool-card-title">{title}</span>
                    <span className="tool-name-badge">{tool.toolName}</span>
                    {summary && (
                        <span className="tool-summary" title={summary}>
                            {summary}
                        </span>
                    )}
                </div>

                <div className="tool-card-right">
                    {tool.durationMs !== undefined && !isRunning && (
                        <span className="tool-duration">{formatDuration(tool.durationMs)}</span>
                    )}
                    {isRunning && (
                        <span className="tool-status-pill tool-status-running">
                            <Loader2 size={10} className="animate-spin" />
                            <span>Calling</span>
                        </span>
                    )}
                    {failed && (
                        <span className="tool-status-pill tool-status-error">
                            <XCircle size={10} />
                            <span>Failed</span>
                        </span>
                    )}
                    {tool.status === "completed" && !failed && !isRunning && (
                        <Check size={13} className="tool-done-mark" />
                    )}
                    <ChevronRight
                        size={12}
                        className={`chat-chevron transition-transform ${open ? "rotate-90" : ""}`}
                    />
                </div>
            </div>

            {open && (
                <div className="tool-card-body">
                    {instruction && (
                        <div className="tool-instruction">
                            <span className="tool-section-label">
                                <BookOpen size={11} /> Instruction
                            </span>
                            <p>{instruction}</p>
                        </div>
                    )}

                    {sql && <CodeBlock code={sql} lang="sql" title="Call · SQL" />}
                    {command && <CodeBlock code={command} lang="bash" title="Call · Shell" />}
                    {path && <div className="tool-path">{path}</div>}

                    {rest.length > 0 && (
                        <div className="tool-section">
                            <div className="tool-section-head">
                                <span className="tool-section-label">Call</span>
                            </div>
                            <div className="tool-kv-grid">
                                {rest.map(([key, value]) => (
                                    <div key={key} className="tool-kv-row">
                                        <span className="tool-kv-key">{key}</span>
                                        <span className="tool-kv-val">
                                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!sql && !command && !path && rest.length === 0 && !instruction && isRunning && (
                        <div className="tool-waiting">Waiting for the call to finish…</div>
                    )}

                    {tool.resultText && !isSyntheticUnavailable && <ToolResultView text={tool.resultText} failed={failed} />}
                </div>
            )}
        </div>
    );
}

function ToolTimeline({ tools }: { tools: ToolInvocation[] }) {
    return (
        <div className="tool-timeline">
            {tools.map((tool) => (
                <ToolInvocationCard key={tool.id} tool={tool} />
            ))}
        </div>
    );
}

// ============================================================================
// Turn grouping & Assistant Turn View
// ============================================================================
export type TurnSegment =
    | { kind: "thinking"; id: string; text: string }
    | { kind: "tools"; id: string; tools: ToolInvocation[] }
    | { kind: "text"; id: string; text: string };

export interface ChatTurn {
    id: string;
    role: "user" | "assistant";
    time: string;
    userText?: string;
    thinking?: string;
    tools: ToolInvocation[];
    assistantText: string;
    segments?: TurnSegment[];
}

function appendSegment(turn: ChatTurn, segment: TurnSegment) {
    const segments = turn.segments ?? (turn.segments = []);
    const last = segments[segments.length - 1];
    if (segment.kind === "thinking" && last?.kind === "thinking") {
        last.text = `${last.text}\n\n${segment.text}`;
        return;
    }
    if (segment.kind === "text" && last?.kind === "text") {
        last.text = `${last.text}\n\n${segment.text}`;
        return;
    }
    if (segment.kind === "tools" && last?.kind === "tools") {
        last.tools.push(...segment.tools);
        return;
    }
    segments.push(segment);
}

function blankAssistant(item: TranscriptItem): ChatTurn {
    return {
        id: item.id,
        role: "assistant",
        time: item.time,
        tools: [],
        assistantText: "",
        segments: [],
    };
}

export function segmentsOf(turn: ChatTurn): TurnSegment[] {
    if (turn.segments && turn.segments.length > 0) return turn.segments;
    const segments: TurnSegment[] = [];
    if (turn.thinking) segments.push({ kind: "thinking", id: `${turn.id}-thinking`, text: turn.thinking });
    if (turn.tools.length > 0) segments.push({ kind: "tools", id: `${turn.id}-tools`, tools: turn.tools });
    if (turn.assistantText.trim()) segments.push({ kind: "text", id: `${turn.id}-text`, text: turn.assistantText });
    return segments;
}

/**
 * Group the module's paired projection (`transcriptFrom`) into chat turns. Tool pairing and status
 * come from `src/transcript`; this only decides segment boundaries and what the view shows.
 */
export function groupIntoTurns(items: readonly TranscriptItem[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    let currentAssistant: ChatTurn | null = null;

    for (const item of items) {
        if (item.role === "user") {
            currentAssistant = null;
            turns.push({
                id: item.id,
                role: "user",
                time: item.time,
                userText: item.text,
                tools: [],
                assistantText: "",
                segments: [],
            });
        } else if (item.role === "assistant") {
            if (!currentAssistant) {
                currentAssistant = blankAssistant(item);
                turns.push(currentAssistant);
            }
            if (item.thinking) {
                currentAssistant.thinking = currentAssistant.thinking
                    ? `${currentAssistant.thinking}\n\n${item.thinking}`
                    : item.thinking;
                appendSegment(currentAssistant, { kind: "thinking", id: `${item.id}-thinking`, text: item.thinking });
            }
            if (item.tools && item.tools.length > 0) {
                currentAssistant.tools.push(...item.tools);
                appendSegment(currentAssistant, { kind: "tools", id: `${item.id}-tools`, tools: [...item.tools] });
            }
            if (item.text) {
                currentAssistant.assistantText = currentAssistant.assistantText
                    ? `${currentAssistant.assistantText}\n\n${item.text}`
                    : item.text;
                appendSegment(currentAssistant, { kind: "text", id: `${item.id}-text`, text: item.text });
            }
            currentAssistant.time = item.time;
        } else if (item.role === "tool") {
            if (!currentAssistant) {
                currentAssistant = blankAssistant(item);
                turns.push(currentAssistant);
            }
            // The projection decided the status; isError covers items built by hand.
            const tool: ToolInvocation = {
                id: item.id,
                callId: item.toolCallId || item.id,
                toolName: item.toolName || "tool",
                summary: item.toolSummary || item.text.slice(0, 80),
                args: item.toolArgs,
                status: item.toolStatus ?? (item.isError ? "error" : "completed"),
                resultText: item.text,
                isError: item.isError,
                durationMs: item.durationMs,
                time: item.time,
            };
            currentAssistant.tools.push(tool);
            appendSegment(currentAssistant, { kind: "tools", id: `${item.id}-tools`, tools: [tool] });
        }
    }
    return turns;
}

export function AssistantTurnView({
    turn,
    live = false,
}: {
    turn: ChatTurn;
    live?: boolean;
}) {
    const { copied, copy } = useClipboard();
    const segments = segmentsOf(turn);
    const hasText = Boolean(turn.assistantText && turn.assistantText.trim());
    const running = turn.tools.some((tool) => tool.status === "running");
    const last = segments[segments.length - 1];
    const showTyping = Boolean(live) && !hasText && !running && last?.kind !== "thinking";

    return (
        <div className="chat-msg chat-assistant" key={turn.id}>
            <span className="chat-avatar" title="DataClaw Agent">
                <BrainCircuit size={14} />
            </span>

            <div className="chat-assistant-body">
                {segments.map((segment, index) => {
                    if (segment.kind === "thinking") {
                        const active = Boolean(live) && !hasText && index === segments.length - 1;
                        return <ThinkingView key={segment.id} text={segment.text} active={active} />;
                    }
                    if (segment.kind === "tools") {
                        return <ToolTimeline key={segment.id} tools={segment.tools} />;
                    }
                    return (
                        <div className="chat-text" key={segment.id}>
                            <MarkdownView content={segment.text} />
                        </div>
                    );
                })}

                {showTyping && (
                    <div className="chat-typing-inline" aria-label="Working">
                        <span>Composing a response…</span>
                        <div className="chat-typing">
                            <i /><i /><i />
                        </div>
                    </div>
                )}

                <div className="chat-msg-footer">
                    <time>{turn.time}</time>
                    {hasText && (
                        <button
                            className="chat-msg-copy-btn"
                            onClick={() => copy(turn.assistantText)}
                            title="Copy response"
                            type="button"
                        >
                            {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                            <span>{copied ? "Copied" : "Copy"}</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// ChatMessageView: complete turn renderer (Thinking + Tools + Markdown)
// ============================================================================
export function ChatMessageView({
    item,
    live = false,
}: {
    item: TranscriptItem;
    live?: boolean;
}) {
    if (item.role === "user") {
        return (
            <div className="chat-msg chat-user" key={item.id}>
                <div className="chat-bubble">
                    <div className="chat-user-text">{item.text}</div>
                </div>
                <time>{item.time}</time>
            </div>
        );
    }

    const turn = groupIntoTurns([item])[0];
    if (!turn || turn.role !== "assistant") return null;
    return <AssistantTurnView turn={turn} live={live} />;
}
