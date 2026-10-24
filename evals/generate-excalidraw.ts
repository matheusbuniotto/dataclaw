import { writeFileSync } from "node:fs";

interface ExcalidrawElement {
    id: string;
    type: "rectangle" | "text" | "arrow" | "line";
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
    strokeColor: string;
    backgroundColor: string;
    fillStyle: string;
    strokeWidth: number;
    strokeStyle: string;
    roughness: number;
    opacity: number;
    groupIds: string[];
    frameId: null;
    roundness: { type: number } | null;
    seed: number;
    version: number;
    versionNonce: number;
    isDeleted: boolean;
    boundElements: null | Array<{ type: string; id: string }>;
    updated: number;
    link: null;
    locked: boolean;
    text?: string;
    fontSize?: number;
    fontFamily?: number;
    textAlign?: string;
    verticalAlign?: string;
    baseline?: number;
    points?: number[][];
}

function createBox(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bg: string,
    stroke = "#1e1e1e",
    round = 3,
): ExcalidrawElement {
    return {
        id,
        type: "rectangle",
        x,
        y,
        width: w,
        height: h,
        angle: 0,
        strokeColor: stroke,
        backgroundColor: bg,
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: round },
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
    };
}

function createText(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    size = 14,
    color = "#1e1e1e",
    align = "center",
): ExcalidrawElement {
    return {
        id,
        type: "text",
        x,
        y,
        width: w,
        height: h,
        angle: 0,
        strokeColor: color,
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        text,
        fontSize: size,
        fontFamily: 1,
        textAlign: align,
        verticalAlign: "middle",
        baseline: size,
    };
}

function createArrow(
    id: string,
    x: number,
    y: number,
    points: number[][],
    stroke = "#4b5563",
): ExcalidrawElement {
    return {
        id,
        type: "arrow",
        x,
        y,
        width: Math.abs(points[1]![0]! - points[0]![0]!),
        height: Math.abs(points[1]![1]! - points[0]![1]!),
        angle: 0,
        strokeColor: stroke,
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 2 },
        seed: Math.floor(Math.random() * 100000),
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        points,
    };
}

export function generateArchitectureExcalidraw(): string {
    const elements: ExcalidrawElement[] = [];

    // Title Block
    elements.push(createBox("title-box", 40, 40, 1120, 70, "#f8fafc", "#cbd5e1"));
    elements.push(createText("title-text", 60, 52, 1080, 26, "DataClaw: Autonomous Agent Architecture & Observability Canvas", 20, "#0f172a", "left"));
    elements.push(createText("title-sub", 60, 80, 1080, 18, "Full-Stack Durability · LangWatch Tracing · Clustered Power Rigor · Growth Telemetry", 13, "#64748b", "left"));

    // 1. Column 1: Persistence & Runtime Engine
    elements.push(createBox("col1-bg", 40, 140, 340, 620, "#eff6ff", "#93c5fd"));
    elements.push(createText("col1-title", 60, 155, 300, 22, "1. Durable State Layer (SQLite WAL)", 16, "#1e3a8a", "left"));

    elements.push(createBox("doc-plan", 60, 195, 300, 70, "#ffffff", "#bfdbfe"));
    elements.push(createText("doc-plan-txt", 70, 205, 280, 45, "AnalystPlanDoc\nHypotheses, goals, milestones\nAtomic checkpoint on each turn", 12, "#1e293b", "left"));

    elements.push(createBox("doc-find", 60, 280, 300, 70, "#ffffff", "#bfdbfe"));
    elements.push(createText("doc-find-txt", 70, 290, 280, 45, "FindingsDoc\nVerified findings, audit verdicts, queries\nSurvives process crash & SIGKILL", 12, "#1e293b", "left"));

    elements.push(createBox("doc-play", 60, 365, 300, 70, "#ffffff", "#bfdbfe"));
    elements.push(createText("doc-play-txt", 70, 375, 280, 45, "PlaybookDoc (Self-Refinement)\nLearned heuristics v1 -> v2\nAutoImprovementTask commits upgrades", 12, "#1e293b", "left"));

    elements.push(createBox("sagas", 60, 455, 300, 80, "#f1f5f9", "#cbd5e1"));
    elements.push(createText("sagas-txt", 70, 465, 280, 55, "Durable Sagas (defineTask)\n• AnalysisWorkflowTask (Multi-phase)\n• AutoImprovementTask (Feedback)\nResumes seamlessly: harness.resume()", 12, "#334155", "left"));

    elements.push(createBox("data-engine", 60, 555, 300, 180, "#ffffff", "#cbd5e1"));
    elements.push(createText("data-engine-txt", 70, 565, 280, 155, "Source-Neutral Safe Data Engine\n• Read-Only AST Guard: rejects mutations\n• Dialects: ANSI, Databricks, Snowflake, BQ\n• Local files: CSV, TSV, JSON, JSONL\n• Cloud Lakehouse: Databricks Unity Catalog\n  over streamable HTTP MCP", 12, "#0f172a", "left"));

    // 2. Column 2: Statistical Verification & Skeptical Auditor
    elements.push(createBox("col2-bg", 420, 140, 360, 620, "#f5f3ff", "#c4b5fd"));
    elements.push(createText("col2-title", 440, 155, 320, 22, "2. Statistical Skepticism & LLM Judge", 16, "#4c1d95", "left"));

    elements.push(createBox("auditor-card", 440, 195, 320, 120, "#ffffff", "#ddd6fe"));
    elements.push(createText("auditor-txt", 450, 205, 300, 95, "Task-Owned Skeptical Auditor\n• Intercepts p-hacking & small sample N < 30\n• Challenges Simpson's Paradox & confounders\n• Verdict: CONFIRMED | CAUTION | REJECTED\n• Only verified findings reach executive memo", 12, "#1e293b", "left"));

    elements.push(createBox("calib-card", 440, 330, 320, 130, "#ffffff", "#ddd6fe"));
    elements.push(createText("calib-txt", 450, 340, 300, 105, "Blind Human Calibration (evals/calibrate.ts)\n• Export audited findings with verdicts stripped\n• Join ground-truth blind human labels\n• Cohen's Kappa: κ = 0.701 (Substantial)\n• Bootstrap CI on inter-rater agreement", 12, "#1e293b", "left"));

    elements.push(createBox("langwatch-card", 440, 480, 320, 255, "#ecfdf5", "#a7f3d0"));
    elements.push(createText("langwatch-txt", 450, 495, 300, 220, "LangWatch Observability (OTel-Native)\n• LangWatchTracer (src/observability/)\n• Trace-level Session Spans (chain)\n• SQL Tool Execution Spans (duration, error)\n• Auditor Review Spans (eval)\n• Stuck-State Guardrails (guardrail tag)\n• Token metrics & Cost per execution\n• Live streaming (/api/v1/collector) or\n  local in-memory trace buffering", 12, "#065f46", "left"));

    // 3. Column 3: Evals, Power Analysis & Growth Flywheel
    elements.push(createBox("col3-bg", 820, 140, 340, 620, "#f0fdf4", "#86efac"));
    elements.push(createText("col3-title", 840, 155, 300, 22, "3. Evals, Power & Growth Attribution", 16, "#064e3b", "left"));

    elements.push(createBox("eval-card", 840, 195, 300, 115, "#ffffff", "#bbf7d0"));
    elements.push(createText("eval-txt", 850, 205, 280, 95, "Clustered Offline Evals (evals/run.ts)\n• 9 tasks × 5 repeats (clustered data)\n• Cluster Bootstrap (2,000 task resamples)\n• Sample Ratio Mismatch check (χ² test)\n• Uncovered 4 real production runtime bugs!", 12, "#1e293b", "left"));

    elements.push(createBox("power-card", 840, 325, 300, 125, "#ffffff", "#bbf7d0"));
    elements.push(createText("power-txt", 850, 335, 280, 105, "Statistical Power Gate (evals/power.ts)\n• Intra-Cluster Correlation: ICC = 0.150\n• Design Effect (VIF): 1.60x variance\n• Current MDE: ±29.9 pp (at 80% power)\n• Sizing Gate: 289 tasks needed for +5 pp\n• Verdict: Blocks underpowered deployments", 12, "#1e293b", "left"));

    elements.push(createBox("growth-card", 840, 465, 300, 270, "#ffffff", "#bbf7d0"));
    elements.push(createText("growth-txt", 850, 475, 280, 245, "Growth Funnel Flywheel (evals/growth-funnel.ts)\n• 5-Stage Funnel: Intent -> Tool -> Activation\n  -> Day-30 Retention -> Lakehouse Expansion\n• Failure Attribution: Stuck loops inflict\n  a -72% onboarding activation drop!\n• Eliminating loops (-24.4 pp stuck):\n  +23.3 pp User Activation Lift\n  +17.6 pp Day-30 Cohort Retention\n  -29.2% Cost per Success (CPSUO)\n  +$1.6M ARR uplift per 10k users", 12, "#14532d", "left"));

    // Connective Arrows
    elements.push(createArrow("arr-col1-col2", 380, 230, [[0, 0], [40, 0]], "#6366f1"));
    elements.push(createArrow("arr-col2-col3", 780, 230, [[0, 0], [40, 0]], "#10b981"));
    elements.push(createArrow("arr-langwatch-growth", 760, 560, [[0, 0], [80, 0]], "#059669"));

    // Bottom Talk-Track Matrix
    elements.push(createBox("bot-box", 40, 780, 1120, 260, "#ffffff", "#e2e8f0"));
    elements.push(createText("bot-title", 60, 795, 1080, 20, "Architecture Defense & Key Decision Rationales", 15, "#0f172a", "left"));

    elements.push(createBox("q1", 60, 830, 260, 190, "#f8fafc", "#cbd5e1"));
    elements.push(createText("q1-txt", 70, 840, 240, 170, "Why Clustered Bootstrap?\nRepeated runs on the same task have ICC = 0.15. Treating them as independent underestimates variance by 1.6x, producing false-positive ship decisions.", 11, "#334155", "left"));

    elements.push(createBox("q2", 340, 830, 260, 190, "#f8fafc", "#cbd5e1"));
    elements.push(createText("q2-txt", 350, 840, 240, 170, "Why SQLite WAL vs Postgres?\nInstantaneous local atomic commits (<1ms), zero operational overhead for ephemeral sandbox containers, and deterministic resumption from disk via harness.resume().", 11, "#334155", "left"));

    elements.push(createBox("q3", 620, 830, 260, 190, "#f8fafc", "#cbd5e1"));
    elements.push(createText("q3-txt", 630, 840, 240, 170, "What Broke in Production?\n4 bugs found through evals:\n1. Model blind to tool rows (content vs output)\n2. Masked SQL errors\n3. undefined query crash\n4. Auditor regex false-positives.", 11, "#334155", "left"));

    elements.push(createBox("q4", 900, 830, 240, 190, "#f8fafc", "#cbd5e1"));
    elements.push(createText("q4-txt", 910, 840, 220, 170, "LangWatch Observability:\nIntegrates OpenTelemetry trace spans, tool metrics, and stuck-detection guardrail tags with local in-memory buffering and zero vendor lock-in.", 11, "#334155", "left"));

    const excalidrawDocument = {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements,
        appState: {
            viewBackgroundColor: "#ffffff",
            gridSize: null,
        },
        files: {},
    };

    return JSON.stringify(excalidrawDocument, null, 2);
}

const json = generateArchitectureExcalidraw();
writeFileSync("docs/architecture.excalidraw", json);
console.log("Generated docs/architecture.excalidraw successfully!");
