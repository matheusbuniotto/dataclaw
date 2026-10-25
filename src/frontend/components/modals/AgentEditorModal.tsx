import React, { useState } from "react";
import {
    Bot,
    BrainCircuit,
    Check,
    ChevronDown,
    ChevronRight,
    Cpu,
    Database,
    Layers,
    Palette,
    Pencil,
    Plus,
    Server,
    ShieldCheck,
    Sparkles,
    Terminal,
    Workflow,
    X,
} from "lucide-react";
import { SpecialistFaceAvatar } from "../../pages/AgentsPage";

export interface AgentCustomization {
    name?: string;
    description?: string;
    role?: string;
    color?: string;
    icon?: string;
    instructions?: string;
    capabilities?: string[];
    compute?: { kind: "shared" | "local" | "docker"; image?: string; network?: "none" | "bridge" } | string;
    skills?: string[];
}

export interface CustomAgentRecord {
    id: string;
    name: string;
    role: string;
    description: string;
    color: string;
    icon: string;
    instructions?: string;
    capabilities?: string[];
    compute?: { kind: "shared" | "local" | "docker"; image?: string; network?: "none" | "bridge" };
    skills?: string[];
    initialTask?: string;
    createdAt: number;
}

export interface SpecialistArchetype {
    id: string;
    role: string;
    title: string;
    tagline: string;
    description: string;
    color: string;
    icon: string;
    capabilities: string[];
    compute: { kind: "shared" | "local" | "docker"; image?: string; network?: "none" | "bridge" };
    instructions: string;
}

export const SPECIALIST_ARCHETYPES: SpecialistArchetype[] = [
    {
        id: "lakehouse_architect",
        role: "lakehouse_architect",
        title: "Lakehouse Scout & Architect",
        tagline: "Unity Catalog, Lineage & Federation",
        description: "Explores catalogs, schemas, tables, and federated external databases across the lakehouse.",
        color: "#ff3621",
        icon: "database",
        capabilities: ["databricks", "analyst", "data", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are a Databricks Lakehouse Scout & Architect for DataClaw.\nExplore Unity Catalog metastores, schemas, and table lineage. Discover Lakehouse Federation connections (Postgres, Snowflake, BigQuery) and profile tabular distributions.\nInspect column nullability, distinct counts, and statistics before making claims.",
    },
    {
        id: "delta_sql_optimizer",
        role: "delta_sql_optimizer",
        title: "Delta Lake & SQL Optimizer",
        tagline: "Liquid Clustering & Query Tuning",
        description: "Crafts high-performance Delta queries, advises on Z-Ordering, partitioning, and liquid clustering.",
        color: "#0284c7",
        icon: "sparkles",
        capabilities: ["databricks", "analyst", "data", "coding"],
        compute: { kind: "local" },
        instructions:
            "You are a Delta Lake & SQL Optimization Specialist for DataClaw.\nWrite performant, idiomatic Databricks SQL queries utilizing Unity Catalog features, liquid clustering, and partition pruning.\nLeverage native Databricks functions (corr, percentile_approx, system.ai functions) and never issue mutating SQL commands.",
    },
    {
        id: "genie_semantic",
        role: "genie_semantic",
        title: "AI/BI Genie Partner",
        tagline: "Certified KPIs & Semantic Layer",
        description: "Consults Databricks Genie spaces, retrieves certified KPI queries, and verifies business metrics.",
        color: "#a855f7",
        icon: "workflow",
        capabilities: ["databricks", "analyst", "data"],
        compute: { kind: "local" },
        instructions:
            "You are an AI/BI Genie Partner for DataClaw.\nConsult curated Databricks Genie spaces to extract certified business logic, metric definitions, and gold-standard queries.\nCross-check user KPI questions against enterprise semantic definitions before formulating ad-hoc SQL.",
    },
    {
        id: "mlflow_evaluator",
        role: "mlflow_evaluator",
        title: "MLflow & Eval Engineer",
        tagline: "Experiments, Traces & Benchmark Gates",
        description: "Tracks experiment runs, logs statistical scores to MLflow, and benchmarks agent and LLM quality.",
        color: "#059669",
        icon: "shield",
        capabilities: ["databricks", "analyst", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are an MLflow & Eval Engineer for DataClaw.\nEvaluate agent analytical quality, detect stuck loops, measure statistical power, and log benchmark scores and experiment artifacts to Databricks MLflow tracking server.\nEnsure reproducible evaluation runs with git commit hashes and model metadata.",
    },
    {
        id: "data_scientist",
        role: "data_scientist",
        title: "Data Scientist",
        tagline: "EDA, Modeling & Statistics",
        description: "Conducts exploratory data analysis, hypothesis testing, and statistical modeling.",
        color: "#8b5cf6",
        icon: "brain",
        capabilities: ["databricks", "analyst", "data", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are a Data Scientist for DataClaw. Conduct rigorous exploratory data analysis, hypothesis testing, and statistical evaluations.\nFormulate testable hypotheses, examine distributions, detect anomalies and confounders (such as Simpson's Paradox or cohort biases), and write Python or SQL scripts in your workspace to model patterns.\nValidate assumptions against observed data before drawing causal or predictive conclusions. Provide reproducible code and clear analytical summaries.",
    },
    {
        id: "mlops",
        role: "mlops",
        title: "MLOps Engineer",
        tagline: "Pipelines, Drift & Sandboxes",
        description: "Monitors model operations, data drift, containerized pipelines, and validation.",
        color: "#06b6d4",
        icon: "workflow",
        capabilities: ["analyst", "data", "coding", "plugins"],
        compute: { kind: "docker", image: "oven/bun:1", network: "none" },
        instructions:
            "You are an MLOps Engineer for DataClaw. Oversee model operations, pipeline reliability, data drift monitoring, and containerized runtime environments.\nValidate input schemas, monitor performance metrics and inference latencies, verify artifact versioning, and automate evaluation pipelines.\nUse bash and file tools in your isolated compute environment to inspect models, check container configurations, and ensure reproducible deployments.",
    },
    {
        id: "data_engineer",
        role: "data_engineer",
        title: "Data Engineer",
        tagline: "ETL, Schemas & Quality",
        description: "Designs ETL/ELT pipelines, catalog schemas, data quality checks, and transforms.",
        color: "#10b981",
        icon: "database",
        capabilities: ["analyst", "data", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are a Data Engineer for DataClaw. Discover catalog schemas, design robust transformation pipelines, and guarantee data quality.\nInspect relational, tabular, and event streams (CSV, TSV, JSON, NDJSON, Parquet, SQL tables), write optimized transformation queries, and check primary key constraints and nullability.",
    },
    {
        id: "analytics_engineer",
        role: "analytics_engineer",
        title: "Analytics Engineer",
        tagline: "Metrics, Marts & Cohorts",
        description: "Builds semantic layers, dimensional data marts, and KPI retention cohorts.",
        color: "#f59e0b",
        icon: "sparkles",
        capabilities: ["analyst", "data", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are an Analytics Engineer for DataClaw. Build clean semantic models, standard dimensional schemas, and trustworthy business metrics.\nDefine unambiguous KPI measures (retention cohorts, ARR/MRR, conversion rates, customer lifetime value) and translate raw database tables into clean analytical marts.",
    },
    {
        id: "researcher",
        role: "researcher",
        title: "Researcher",
        tagline: "Evidence, Catalogs & Briefs",
        description: "Gathers empirical evidence, queries connected catalogs, and writes cited briefs.",
        color: "#276d60",
        icon: "terminal",
        capabilities: ["analyst", "data", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are a researcher for DataClaw. Gather evidence and return a cited brief.\nExplore before you claim. Profile and query local files or connected data sources, and use read for workspace files.\nDo not invent catalogs, tables, columns, or statistics.",
    },
    {
        id: "reviewer",
        role: "reviewer",
        title: "Auditor & Reviewer",
        tagline: "Verification & Audit",
        description: "Cross-checks numerical findings, verifies queries, and audits assumptions.",
        color: "#6366f1",
        icon: "shield",
        capabilities: ["analyst", "data", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are a reviewer for DataClaw. Check the task's claim against evidence and return actionable findings.\nName what holds, what is weak, and what to measure next.\nWhen data access is available, re-run the evidence query before you agree with the claim.",
    },
    {
        id: "custom",
        role: "custom",
        title: "Custom Specialist",
        tagline: "Bespoke Persona & Tools",
        description: "Bespoke data & AI specialist tailored for custom analytical tasks.",
        color: "#52796f",
        icon: "bot",
        capabilities: ["analyst", "data", "coding", "plugins"],
        compute: { kind: "local" },
        instructions:
            "You are a custom specialist for DataClaw. Follow instructions and deliver verified data insights.",
    },
];

export const AVAILABLE_CAPABILITY_OPTIONS = [
    {
        id: "databricks",
        label: "Databricks Lakehouse",
        description: "Unity Catalog MCP, Genie Spaces, system.ai SQL functions, MLflow evals & Lakehouse Federation",
    },
    {
        id: "data",
        label: "Data Sources",
        description: "Query & profile SQLite, DuckDB, Parquet, Databricks, PostgreSQL",
    },
    {
        id: "analyst",
        label: "Statistical Analyst",
        description: "Hypothesis testing, distributions, playbooks, and audit findings",
    },
    {
        id: "coding",
        label: "Coding & Shell",
        description: "Read, write, edit files and execute bash in agent workspace",
    },
    {
        id: "plugins",
        label: "MCP & Plugins",
        description: "Search and load dynamic tool plugins over MCP",
    },
    {
        id: "features",
        label: "Self-Extension",
        description: "Create skills and plugins for DataClaw at runtime",
    },
    {
        id: "roster",
        label: "Team Delegation",
        description: "Delegate tasks and manage specialist roster",
    },
];

export const PRESET_COLORS = [
    { label: "Classic Forest", hex: "#276d60" },
    { label: "Emerald", hex: "#10b981" },
    { label: "Warm Amber", hex: "#f59e0b" },
    { label: "Deep Violet", hex: "#8b5cf6" },
    { label: "Electric Indigo", hex: "#6366f1" },
    { label: "Ocean Cyan", hex: "#06b6d4" },
    { label: "Ruby Rose", hex: "#f43f5e" },
    { label: "Slate Sage", hex: "#52796f" },
];

export const ICON_OPTIONS = [
    { id: "dot-eyes", label: "Cute Eyes", icon: "··" },
    { id: "brain", label: "Brain", icon: BrainCircuit },
    { id: "bot", label: "Bot", icon: Bot },
    { id: "database", label: "Database", icon: Database },
    { id: "sparkles", label: "Sparkles", icon: Sparkles },
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "workflow", label: "Workflow", icon: Workflow },
    { id: "shield", label: "Shield", icon: ShieldCheck },
];

export function loadAgentCustomizations(): Record<string, AgentCustomization> {
    try {
        if (typeof window === "undefined") return {};
        const raw = localStorage.getItem("dataclaw_agent_customizations");
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function saveAgentCustomization(agentId: string, custom: AgentCustomization) {
    try {
        if (typeof window === "undefined") return {};
        const all = loadAgentCustomizations();
        all[agentId] = { ...(all[agentId] || {}), ...custom };
        localStorage.setItem("dataclaw_agent_customizations", JSON.stringify(all));
        return all;
    } catch {
        return {};
    }
}

export function loadCustomAgents(): CustomAgentRecord[] {
    try {
        if (typeof window === "undefined") return [];
        const raw = localStorage.getItem("dataclaw_custom_agents");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function saveCustomAgent(record: CustomAgentRecord): CustomAgentRecord[] {
    try {
        if (typeof window === "undefined") return [];
        const all = loadCustomAgents().filter((a) => a.id !== record.id);
        all.push(record);
        localStorage.setItem("dataclaw_custom_agents", JSON.stringify(all));
        return all;
    } catch {
        return [];
    }
}

export function deleteCustomAgent(agentId: string): CustomAgentRecord[] {
    try {
        if (typeof window === "undefined") return [];
        const all = loadCustomAgents().filter((a) => a.id !== agentId);
        localStorage.setItem("dataclaw_custom_agents", JSON.stringify(all));
        return all;
    } catch {
        return [];
    }
}

function resolveIsDark(explicitDark?: boolean): boolean {
    if (explicitDark !== undefined) return explicitDark;
    if (typeof document !== "undefined") {
        return (
            document.documentElement.classList.contains("theme-dark") ||
            document.documentElement.classList.contains("theme-lovable") ||
            document.documentElement.classList.contains("dark") ||
            document.documentElement.getAttribute("data-theme") === "dark" ||
            document.documentElement.getAttribute("data-theme") === "lovable"
        );
    }
    return false;
}

function getModalTheme(isDark: boolean) {
    return {
        isDark,
        backdrop: isDark ? "rgba(0, 0, 0, 0.72)" : "rgba(15, 23, 42, 0.45)",
        bg: isDark ? "#10141d" : "#ffffff",
        headerBg: isDark ? "#141924" : "#fbf9f5",
        cardBg: isDark ? "#151a26" : "#f8f6f0",
        cardBorder: isDark ? "rgba(255, 255, 255, 0.08)" : "#e6e2d8",
        border: isDark ? "rgba(255, 255, 255, 0.1)" : "#e2ded4",
        borderSubtle: isDark ? "rgba(255, 255, 255, 0.05)" : "#ece8de",
        textPrimary: isDark ? "#f1f5f9" : "#1e293b",
        textSecondary: isDark ? "#94a3b8" : "#475569",
        textMuted: isDark ? "#64748b" : "#6b7c75",
        inputBg: isDark ? "#161c28" : "#ffffff",
        inputBorder: isDark ? "rgba(255, 255, 255, 0.12)" : "#d8d4c7",
        inputFocusBorder: isDark ? "#10b981" : "#276d60",
        accent: isDark ? "#10b981" : "#276d60",
        accentHover: isDark ? "#059669" : "#1f584e",
        accentSubtle: isDark ? "rgba(16, 185, 129, 0.12)" : "#eef6f2",
        accentText: isDark ? "#34d399" : "#1f584e",
        activePillBg: isDark ? "rgba(16, 185, 129, 0.15)" : "#e0ece5",
        activePillText: isDark ? "#34d399" : "#226353",
        shadow: isDark
            ? "0 24px 48px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)"
            : "0 24px 48px -12px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06)",
        footerBg: isDark ? "#121721" : "#faf9f5",
        hoverBg: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)",
    };
}

// ============================================================================
// Modal to Customize an Existing Specialist Teammate
// ============================================================================
export function AgentEditorModal({
    agent,
    isOpen,
    onClose,
    onSave,
    isDark,
}: {
    agent: {
        id: string;
        name: string;
        description: string;
        color?: string;
        icon?: string;
        role?: string;
    };
    isOpen: boolean;
    onClose: () => void;
    onSave: (customization: AgentCustomization) => void;
    isDark?: boolean;
}) {
    const isDarkMode = resolveIsDark(isDark);
    const theme = getModalTheme(isDarkMode);

    const [name, setName] = useState(agent.name);
    const [role, setRole] = useState(agent.role || "Specialist");
    const [description, setDescription] = useState(agent.description);
    const [color, setColor] = useState(agent.color || "#276d60");
    const [icon, setIcon] = useState(agent.icon || "dot-eyes");

    if (!isOpen) return null;

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            name: name.trim() || agent.name,
            role: role.trim() || agent.role,
            description: description.trim() || agent.description,
            color,
            icon,
        });
        onClose();
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: theme.backdrop,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10000,
                padding: 16,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 16,
                    width: "100%",
                    maxWidth: 480,
                    boxShadow: theme.shadow,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    animation: "modalFadeIn 0.18s ease-out",
                    fontFamily: "var(--app-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                    color: theme.textPrimary,
                }}
            >
                <style>{`
                    @keyframes modalFadeIn {
                        from { opacity: 0; transform: scale(0.97) translateY(6px); }
                        to { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>

                {/* Modal Header */}
                <div
                    style={{
                        padding: "16px 20px",
                        borderBottom: `1px solid ${theme.borderSubtle}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: theme.headerBg,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 8,
                                background: theme.accentSubtle,
                                display: "grid",
                                placeItems: "center",
                                color: theme.accent,
                            }}
                        >
                            <Pencil size={15} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 14.5, color: theme.textPrimary, lineHeight: 1.2 }}>
                                Edit Specialist Profile
                            </div>
                            <div style={{ fontSize: 11, color: theme.textMuted }}>
                                Personalize identity and presentation for {agent.name}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: theme.textMuted,
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 6,
                            display: "grid",
                            placeItems: "center",
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSave} style={{ padding: "18px 22px 20px" }}>
                    {/* Live Preview Card */}
                    <div
                        style={{
                            background: theme.cardBg,
                            border: `1px solid ${theme.cardBorder}`,
                            borderRadius: 12,
                            padding: "12px 14px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            marginBottom: 16,
                        }}
                    >
                        <SpecialistFaceAvatar name={name || agent.name} color={color} icon={icon} size={42} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{name || agent.name}</span>
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: theme.activePillBg,
                                        color: theme.activePillText,
                                    }}
                                >
                                    {role}
                                </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: theme.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                                {description || "Role and purpose description"}
                            </div>
                        </div>
                    </div>

                    {/* Agent Name & Role Grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                            <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                                Specialist Name
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Churn Analyst"
                                required
                                style={{
                                    width: "100%",
                                    background: theme.inputBg,
                                    border: `1px solid ${theme.inputBorder}`,
                                    borderRadius: 8,
                                    padding: "7px 10px",
                                    fontSize: 13,
                                    color: theme.textPrimary,
                                    outline: "none",
                                    boxSizing: "border-box",
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                                Role / Title
                            </label>
                            <input
                                type="text"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                placeholder="e.g. data_scientist"
                                style={{
                                    width: "100%",
                                    background: theme.inputBg,
                                    border: `1px solid ${theme.inputBorder}`,
                                    borderRadius: 8,
                                    padding: "7px 10px",
                                    fontSize: 13,
                                    fontFamily: "var(--app-font-mono, monospace)",
                                    color: theme.textPrimary,
                                    outline: "none",
                                    boxSizing: "border-box",
                                }}
                            />
                        </div>
                    </div>

                    {/* Agent Purpose & Description */}
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                            Purpose & Scope
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe what data this agent explores or questions it resolves..."
                            rows={2}
                            style={{
                                width: "100%",
                                background: theme.inputBg,
                                border: `1px solid ${theme.inputBorder}`,
                                borderRadius: 8,
                                padding: "7px 10px",
                                fontSize: 12.5,
                                color: theme.textPrimary,
                                outline: "none",
                                resize: "vertical",
                                lineHeight: 1.4,
                                boxSizing: "border-box",
                                fontFamily: "inherit",
                            }}
                        />
                    </div>

                    {/* Icon Selection */}
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 6 }}>
                            Avatar Icon
                        </label>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
                            {ICON_OPTIONS.map((item) => {
                                const isSelected = icon === item.id;
                                const IconCmp = item.icon;
                                return (
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => setIcon(item.id)}
                                        title={item.label}
                                        style={{
                                            border: isSelected ? `2px solid ${theme.accent}` : `1px solid ${theme.cardBorder}`,
                                            background: isSelected ? theme.accentSubtle : theme.inputBg,
                                            color: isSelected ? theme.accentText : theme.textSecondary,
                                            borderRadius: 8,
                                            padding: "6px 2px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {typeof IconCmp === "string" ? (
                                            <span style={{ fontWeight: 800, fontSize: 14 }}>{IconCmp}</span>
                                        ) : (
                                            <IconCmp size={16} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Color Swatch Picker */}
                    <div style={{ marginBottom: 18 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <label style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted }}>
                                Accent Color
                            </label>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    title="Choose custom color"
                                    style={{
                                        width: 18,
                                        height: 18,
                                        padding: 0,
                                        border: `1px solid ${theme.inputBorder}`,
                                        borderRadius: 4,
                                        cursor: "pointer",
                                        background: "transparent",
                                    }}
                                />
                                <span style={{ fontFamily: "var(--app-font-mono, monospace)", fontSize: 10, color: theme.textMuted }}>
                                    {color.toUpperCase()}
                                </span>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
                            {PRESET_COLORS.map((preset) => {
                                const isSelected = color.toLowerCase() === preset.hex.toLowerCase();
                                return (
                                    <button
                                        type="button"
                                        key={preset.hex}
                                        onClick={() => setColor(preset.hex)}
                                        title={preset.label}
                                        style={{
                                            height: 28,
                                            borderRadius: 6,
                                            background: preset.hex,
                                            border: isSelected ? "2px solid #ffffff" : "1px solid rgba(0,0,0,0.15)",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: "#ffffff",
                                            boxShadow: isSelected ? `0 0 0 2px ${theme.accent}` : "none",
                                        }}
                                    >
                                        {isSelected && <Check size={12} strokeWidth={3} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Modal Actions */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 8,
                            paddingTop: 12,
                            borderTop: `1px solid ${theme.borderSubtle}`,
                        }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                background: theme.hoverBg,
                                border: `1px solid ${theme.border}`,
                                color: theme.textSecondary,
                                borderRadius: 8,
                                padding: "7px 14px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            style={{
                                background: theme.accent,
                                border: "none",
                                color: "#ffffff",
                                borderRadius: 8,
                                padding: "7px 16px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ============================================================================
// Modal to Configure and Create a New Specialist Teammate
// (Refactored with Modern Dark Theme, Progressive Disclosure, and Streamlined UI)
// ============================================================================
export function CreateAgentModal({
    isOpen,
    onClose,
    onCreate,
    availableSkills = [],
    isDark,
}: {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (agent: {
        name: string;
        role: string;
        description: string;
        color: string;
        icon: string;
        instructions?: string;
        capabilities?: string[];
        compute?: { kind: "shared" | "local" | "docker"; image?: string; network?: "none" | "bridge" };
        skills?: string[];
        initialTask?: string;
    }) => void;
    availableSkills?: Array<{ name: string; description: string }>;
    isDark?: boolean;
}) {
    const isDarkMode = resolveIsDark(isDark);
    const theme = getModalTheme(isDarkMode);

    const defaultArchetype = SPECIALIST_ARCHETYPES[0]!;
    const [selectedArchetypeId, setSelectedArchetypeId] = useState(defaultArchetype.id);
    const [name, setName] = useState(defaultArchetype.title);
    const [role, setRole] = useState(defaultArchetype.role);
    const [description, setDescription] = useState(defaultArchetype.description);
    const [instructions, setInstructions] = useState(defaultArchetype.instructions);
    const [capabilities, setCapabilities] = useState<string[]>([...defaultArchetype.capabilities]);
    const [computeKind, setComputeKind] = useState<"shared" | "local" | "docker">(defaultArchetype.compute.kind);
    const [dockerImage, setDockerImage] = useState(defaultArchetype.compute.image || "oven/bun:1");
    const [dockerNetwork, setDockerNetwork] = useState<"none" | "bridge">(defaultArchetype.compute.network || "none");
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [color, setColor] = useState(defaultArchetype.color);
    const [icon, setIcon] = useState(defaultArchetype.icon);
    const [initialTask, setInitialTask] = useState("");

    // Progressive Disclosure Collapsible States
    const [openCapabilities, setOpenCapabilities] = useState(false);
    const [openCompute, setOpenCompute] = useState(false);
    const [openInstructions, setOpenInstructions] = useState(false);
    const [openAppearance, setOpenAppearance] = useState(false);

    if (!isOpen) return null;

    const handleSelectArchetype = (archId: string) => {
        const arch = SPECIALIST_ARCHETYPES.find((a) => a.id === archId);
        if (!arch) return;
        setSelectedArchetypeId(arch.id);
        setName(arch.title);
        setRole(arch.role);
        setDescription(arch.description);
        setInstructions(arch.instructions);
        setCapabilities([...arch.capabilities]);
        setComputeKind(arch.compute.kind);
        if (arch.compute.image) setDockerImage(arch.compute.image);
        if (arch.compute.network) setDockerNetwork(arch.compute.network);
        setColor(arch.color);
        setIcon(arch.icon);
    };

    const toggleCapability = (capId: string) => {
        setCapabilities((prev) =>
            prev.includes(capId) ? prev.filter((c) => c !== capId) : [...prev, capId]
        );
    };

    const toggleSkill = (skillName: string) => {
        setSelectedSkills((prev) =>
            prev.includes(skillName) ? prev.filter((s) => s !== skillName) : [...prev, skillName]
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) return;

        const computeConfig =
            computeKind === "docker"
                ? { kind: "docker" as const, image: dockerImage.trim() || "oven/bun:1", network: dockerNetwork }
                : { kind: computeKind };

        onCreate({
            name: trimmedName,
            role: role.trim() || "data_scientist",
            description: description.trim() || `Specialist dedicated to ${trimmedName} analytical workflows.`,
            instructions: instructions.trim() || undefined,
            capabilities: capabilities.length > 0 ? capabilities : ["analyst", "data", "coding", "plugins"],
            compute: computeConfig,
            skills: selectedSkills.length > 0 ? selectedSkills : undefined,
            color,
            icon,
            initialTask: initialTask.trim() || undefined,
        });
        onClose();
    };

    const activeArchetype = SPECIALIST_ARCHETYPES.find((a) => a.id === selectedArchetypeId) || defaultArchetype;

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: theme.backdrop,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10000,
                padding: 16,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 16,
                    width: "100%",
                    maxWidth: 560,
                    boxShadow: theme.shadow,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    animation: "modalFadeIn 0.18s ease-out",
                    fontFamily: "var(--app-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                    color: theme.textPrimary,
                    maxHeight: "90vh",
                }}
            >
                <style>{`
                    @keyframes modalFadeIn {
                        from { opacity: 0; transform: scale(0.97) translateY(6px); }
                        to { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>

                {/* Header */}
                <div
                    style={{
                        padding: "16px 20px 14px",
                        borderBottom: `1px solid ${theme.borderSubtle}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: theme.headerBg,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background: theme.accentSubtle,
                                display: "grid",
                                placeItems: "center",
                                color: theme.accent,
                            }}
                        >
                            <Sparkles size={16} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: theme.textPrimary, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                                New Specialist
                            </div>
                            <div style={{ fontSize: 11, color: theme.textMuted }}>
                                Autonomous teammate with dedicated compute & tools
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: theme.textMuted,
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 6,
                            display: "grid",
                            placeItems: "center",
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <form
                    onSubmit={handleSubmit}
                    style={{
                        padding: "16px 20px 20px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                    }}
                >
                    {/* Live Specialist Header Preview */}
                    <div
                        style={{
                            background: theme.cardBg,
                            border: `1px solid ${theme.cardBorder}`,
                            borderRadius: 12,
                            padding: "10px 14px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                        }}
                    >
                        <div
                            onClick={() => setOpenAppearance(!openAppearance)}
                            title="Click to customize avatar appearance"
                            style={{ cursor: "pointer", position: "relative" }}
                        >
                            <SpecialistFaceAvatar name={name || "New Specialist"} color={color} icon={icon} size={40} />
                            <div
                                style={{
                                    position: "absolute",
                                    bottom: -2,
                                    right: -2,
                                    width: 14,
                                    height: 14,
                                    borderRadius: "50%",
                                    background: theme.bg,
                                    border: `1px solid ${theme.cardBorder}`,
                                    display: "grid",
                                    placeItems: "center",
                                    color: theme.textSecondary,
                                }}
                            >
                                <Palette size={9} />
                            </div>
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span>{name || "Specialist Name"}</span>
                                <span
                                    style={{
                                        fontSize: 9.5,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: theme.activePillBg,
                                        color: theme.activePillText,
                                    }}
                                >
                                    {role}
                                </span>
                                <span
                                    style={{
                                        fontSize: 9.5,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: computeKind === "docker" ? (isDarkMode ? "rgba(6, 182, 212, 0.15)" : "#e0f2fe") : theme.hoverBg,
                                        color: computeKind === "docker" ? (isDarkMode ? "#22d3ee" : "#0369a1") : theme.textSecondary,
                                    }}
                                >
                                    {computeKind === "docker" ? "Docker Sandbox" : computeKind === "local" ? "Local Agent Home" : "Shared Workspace"}
                                </span>
                            </div>
                            <div style={{ fontSize: 11, color: theme.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                                {description || "Domain mission and analytical tasks..."}
                            </div>
                        </div>
                    </div>

                    {/* Step 1: Specialist Archetype Dropdown (Clean, high-visibility select) */}
                    <div>
                        <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 6 }}>
                            Specialist Archetype
                        </label>
                        <div style={{ position: "relative" }}>
                            <select
                                value={selectedArchetypeId}
                                onChange={(e) => handleSelectArchetype(e.target.value)}
                                style={{
                                    width: "100%",
                                    appearance: "none",
                                    WebkitAppearance: "none",
                                    background: theme.inputBg,
                                    border: `1px solid ${theme.inputBorder}`,
                                    borderRadius: 9,
                                    padding: "8px 30px 8px 12px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: theme.textPrimary,
                                    outline: "none",
                                    cursor: "pointer",
                                    boxSizing: "border-box",
                                }}
                            >
                                {SPECIALIST_ARCHETYPES.map((arch) => (
                                    <option key={arch.id} value={arch.id}>
                                        {arch.title} — {arch.tagline}
                                    </option>
                                ))}
                            </select>
                            <div
                                style={{
                                    position: "absolute",
                                    right: 12,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    pointerEvents: "none",
                                    color: theme.textMuted,
                                    display: "flex",
                                    alignItems: "center",
                                }}
                            >
                                <ChevronDown size={14} />
                            </div>
                        </div>
                    </div>

                    {/* Step 2: Name & Role Identifier */}
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10 }}>
                        <div>
                            <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                                Teammate Name <span style={{ color: theme.accent }}>*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Churn Scientist"
                                required
                                style={{
                                    width: "100%",
                                    background: theme.inputBg,
                                    border: `1px solid ${theme.inputBorder}`,
                                    borderRadius: 8,
                                    padding: "7px 10px",
                                    fontSize: 12.5,
                                    color: theme.textPrimary,
                                    outline: "none",
                                    boxSizing: "border-box",
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                                Role Identifier
                            </label>
                            <input
                                type="text"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                placeholder="e.g. data_scientist"
                                style={{
                                    width: "100%",
                                    background: theme.inputBg,
                                    border: `1px solid ${theme.inputBorder}`,
                                    borderRadius: 8,
                                    padding: "7px 10px",
                                    fontSize: 12.5,
                                    fontFamily: "var(--app-font-mono, monospace)",
                                    color: theme.textPrimary,
                                    outline: "none",
                                    boxSizing: "border-box",
                                }}
                            />
                        </div>
                    </div>

                    {/* Step 3: Purpose & Mission */}
                    <div>
                        <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                            Purpose & Scope
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What analytical questions or datasets does this agent explore?"
                            rows={2}
                            style={{
                                width: "100%",
                                background: theme.inputBg,
                                border: `1px solid ${theme.inputBorder}`,
                                borderRadius: 8,
                                padding: "7px 10px",
                                fontSize: 12,
                                color: theme.textPrimary,
                                outline: "none",
                                resize: "vertical",
                                lineHeight: 1.4,
                                boxSizing: "border-box",
                                fontFamily: "inherit",
                            }}
                        />
                    </div>

                    {/* Step 4: Optional Kickoff Task */}
                    <div>
                        <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                            Initial Task (Optional)
                        </label>
                        <input
                            type="text"
                            value={initialTask}
                            onChange={(e) => setInitialTask(e.target.value)}
                            placeholder="e.g. Profile customer_churn table and test for Simpson's Paradox"
                            style={{
                                width: "100%",
                                background: theme.inputBg,
                                border: `1px solid ${theme.inputBorder}`,
                                borderRadius: 8,
                                padding: "7px 10px",
                                fontSize: 12,
                                color: theme.textPrimary,
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                        />
                    </div>

                    {/* ========================================================================= */}
                    {/* PROGRESSIVE DISCLOSURE ACCORDIONS (Advanced Settings) */}
                    {/* ========================================================================= */}

                    {/* Accordion 1: Tooling Capabilities */}
                    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                        <button
                            type="button"
                            onClick={() => setOpenCapabilities(!openCapabilities)}
                            style={{
                                width: "100%",
                                padding: "9px 12px",
                                background: theme.cardBg,
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                color: theme.textPrimary,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 650 }}>
                                <Cpu size={14} color={theme.accent} />
                                <span>Tooling & Capabilities</span>
                                <span
                                    style={{
                                        fontSize: 9.5,
                                        fontWeight: 700,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: theme.activePillBg,
                                        color: theme.activePillText,
                                    }}
                                >
                                    {capabilities.length} active
                                </span>
                            </div>
                            <div style={{ color: theme.textMuted, display: "flex", alignItems: "center" }}>
                                {openCapabilities ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>
                        </button>

                        {openCapabilities && (
                            <div style={{ padding: "10px 12px 12px", borderTop: `1px solid ${theme.borderSubtle}`, background: theme.bg }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                    {AVAILABLE_CAPABILITY_OPTIONS.map((cap) => {
                                        const isChecked = capabilities.includes(cap.id);
                                        return (
                                            <button
                                                type="button"
                                                key={cap.id}
                                                onClick={() => toggleCapability(cap.id)}
                                                style={{
                                                    border: isChecked ? `1.5px solid ${theme.accent}` : `1px solid ${theme.inputBorder}`,
                                                    background: isChecked ? theme.accentSubtle : theme.inputBg,
                                                    borderRadius: 7,
                                                    padding: "6px 8px",
                                                    display: "flex",
                                                    alignItems: "flex-start",
                                                    gap: 6,
                                                    cursor: "pointer",
                                                    textAlign: "left",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 14,
                                                        height: 14,
                                                        borderRadius: 3,
                                                        border: isChecked ? `1px solid ${theme.accent}` : `1px solid ${theme.textMuted}`,
                                                        background: isChecked ? theme.accent : "transparent",
                                                        display: "grid",
                                                        placeItems: "center",
                                                        color: "#ffffff",
                                                        flexShrink: 0,
                                                        marginTop: 2,
                                                    }}
                                                >
                                                    {isChecked && <Check size={10} strokeWidth={3} />}
                                                </div>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontSize: 11, fontWeight: 700, color: isChecked ? theme.accentText : theme.textPrimary }}>
                                                        {cap.label}
                                                    </div>
                                                    <div style={{ fontSize: 9.5, color: theme.textMuted, marginTop: 1, lineHeight: 1.25 }}>
                                                        {cap.description}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Accordion 2: Compute Sandbox */}
                    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                        <button
                            type="button"
                            onClick={() => setOpenCompute(!openCompute)}
                            style={{
                                width: "100%",
                                padding: "9px 12px",
                                background: theme.cardBg,
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                color: theme.textPrimary,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 650 }}>
                                <Server size={14} color={theme.accent} />
                                <span>Compute & Execution Sandbox</span>
                                <span
                                    style={{
                                        fontSize: 9.5,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: theme.hoverBg,
                                        color: theme.textSecondary,
                                    }}
                                >
                                    {computeKind === "docker" ? "Docker Sandbox" : computeKind === "local" ? "Local Directory" : "Shared Workspace"}
                                </span>
                            </div>
                            <div style={{ color: theme.textMuted, display: "flex", alignItems: "center" }}>
                                {openCompute ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>
                        </button>

                        {openCompute && (
                            <div style={{ padding: "10px 12px 12px", borderTop: `1px solid ${theme.borderSubtle}`, background: theme.bg }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                                    {[
                                        { kind: "local" as const, label: "Local Directory", desc: "/workspace/agents/<id>" },
                                        { kind: "docker" as const, label: "Docker Sandbox", desc: "Isolated container" },
                                        { kind: "shared" as const, label: "Shared Workspace", desc: "Root /workspace" },
                                    ].map((item) => {
                                        const isSelected = computeKind === item.kind;
                                        return (
                                            <button
                                                type="button"
                                                key={item.kind}
                                                onClick={() => setComputeKind(item.kind)}
                                                style={{
                                                    border: isSelected ? `1.5px solid ${theme.accent}` : `1px solid ${theme.inputBorder}`,
                                                    background: isSelected ? theme.accentSubtle : theme.inputBg,
                                                    borderRadius: 7,
                                                    padding: "6px 8px",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "flex-start",
                                                    textAlign: "left",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? theme.accentText : theme.textPrimary }}>
                                                    {item.label}
                                                </span>
                                                <span style={{ fontSize: 9.5, color: theme.textMuted, marginTop: 1 }}>
                                                    {item.desc}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {computeKind === "docker" && (
                                    <div
                                        style={{
                                            marginTop: 8,
                                            padding: "8px 10px",
                                            background: theme.cardBg,
                                            border: `1px solid ${theme.cardBorder}`,
                                            borderRadius: 8,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: "block", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", color: theme.textMuted, marginBottom: 3 }}>
                                                Container Image
                                            </label>
                                            <input
                                                type="text"
                                                value={dockerImage}
                                                onChange={(e) => setDockerImage(e.target.value)}
                                                placeholder="oven/bun:1"
                                                style={{
                                                    width: "100%",
                                                    padding: "5px 8px",
                                                    fontSize: 11.5,
                                                    fontFamily: "var(--app-font-mono, monospace)",
                                                    border: `1px solid ${theme.inputBorder}`,
                                                    borderRadius: 6,
                                                    background: theme.inputBg,
                                                    color: theme.textPrimary,
                                                    boxSizing: "border-box",
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: "block", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", color: theme.textMuted, marginBottom: 3 }}>
                                                Network
                                            </label>
                                            <div style={{ display: "flex", gap: 3 }}>
                                                {(["none", "bridge"] as const).map((net) => (
                                                    <button
                                                        type="button"
                                                        key={net}
                                                        onClick={() => setDockerNetwork(net)}
                                                        style={{
                                                            padding: "4px 8px",
                                                            fontSize: 10.5,
                                                            fontWeight: 600,
                                                            borderRadius: 5,
                                                            border: dockerNetwork === net ? `1px solid ${theme.accent}` : `1px solid ${theme.inputBorder}`,
                                                            background: dockerNetwork === net ? theme.accent : theme.inputBg,
                                                            color: dockerNetwork === net ? "#ffffff" : theme.textSecondary,
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        {net === "none" ? "Offline" : "Bridge"}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Accordion 3: System Persona & Instructions */}
                    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                        <button
                            type="button"
                            onClick={() => setOpenInstructions(!openInstructions)}
                            style={{
                                width: "100%",
                                padding: "9px 12px",
                                background: theme.cardBg,
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                color: theme.textPrimary,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 650 }}>
                                <Terminal size={14} color={theme.accent} />
                                <span>Operating Persona & Instructions</span>
                            </div>
                            <div style={{ color: theme.textMuted, display: "flex", alignItems: "center" }}>
                                {openInstructions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>
                        </button>

                        {openInstructions && (
                            <div style={{ padding: "10px 12px 12px", borderTop: `1px solid ${theme.borderSubtle}`, background: theme.bg }}>
                                <textarea
                                    value={instructions}
                                    onChange={(e) => setInstructions(e.target.value)}
                                    rows={4}
                                    placeholder="Enter system instructions, analytical methodology, and domain guardrails..."
                                    style={{
                                        width: "100%",
                                        background: theme.inputBg,
                                        border: `1px solid ${theme.inputBorder}`,
                                        borderRadius: 8,
                                        padding: "8px 10px",
                                        fontSize: 11.5,
                                        color: theme.textPrimary,
                                        outline: "none",
                                        resize: "vertical",
                                        lineHeight: 1.45,
                                        boxSizing: "border-box",
                                        fontFamily: "inherit",
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Accordion 4: Appearance, Colors & Skills */}
                    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                        <button
                            type="button"
                            onClick={() => setOpenAppearance(!openAppearance)}
                            style={{
                                width: "100%",
                                padding: "9px 12px",
                                background: theme.cardBg,
                                border: "none",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                cursor: "pointer",
                                color: theme.textPrimary,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 650 }}>
                                <Palette size={14} color={theme.accent} />
                                <span>Appearance, Palette & Skills</span>
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, border: "1px solid rgba(255,255,255,0.4)" }} />
                            </div>
                            <div style={{ color: theme.textMuted, display: "flex", alignItems: "center" }}>
                                {openAppearance ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>
                        </button>

                        {openAppearance && (
                            <div style={{ padding: "12px 14px", borderTop: `1px solid ${theme.borderSubtle}`, background: theme.bg, display: "flex", flexDirection: "column", gap: 12 }}>
                                {/* Icon Style */}
                                <div>
                                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                                        Avatar Icon Style
                                    </label>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
                                        {ICON_OPTIONS.map((item) => {
                                            const isSelected = icon === item.id;
                                            const IconCmp = item.icon;
                                            return (
                                                <button
                                                    type="button"
                                                    key={item.id}
                                                    onClick={() => setIcon(item.id)}
                                                    title={item.label}
                                                    style={{
                                                        border: isSelected ? `2px solid ${theme.accent}` : `1px solid ${theme.cardBorder}`,
                                                        background: isSelected ? theme.accentSubtle : theme.inputBg,
                                                        color: isSelected ? theme.accentText : theme.textSecondary,
                                                        borderRadius: 7,
                                                        padding: "6px 2px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    {typeof IconCmp === "string" ? (
                                                        <span style={{ fontWeight: 800, fontSize: 13 }}>{IconCmp}</span>
                                                    ) : (
                                                        <IconCmp size={15} />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Color Swatches */}
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                                        <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted }}>
                                            Accent Color
                                        </label>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <input
                                                type="color"
                                                value={color}
                                                onChange={(e) => setColor(e.target.value)}
                                                title="Choose custom color"
                                                style={{
                                                    width: 16,
                                                    height: 16,
                                                    padding: 0,
                                                    border: `1px solid ${theme.inputBorder}`,
                                                    borderRadius: 4,
                                                    cursor: "pointer",
                                                    background: "transparent",
                                                }}
                                            />
                                            <span style={{ fontFamily: "var(--app-font-mono, monospace)", fontSize: 10, color: theme.textMuted }}>
                                                {color.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
                                        {PRESET_COLORS.map((preset) => {
                                            const isSelected = color.toLowerCase() === preset.hex.toLowerCase();
                                            return (
                                                <button
                                                    type="button"
                                                    key={preset.hex}
                                                    onClick={() => setColor(preset.hex)}
                                                    title={preset.label}
                                                    style={{
                                                        height: 24,
                                                        borderRadius: 6,
                                                        background: preset.hex,
                                                        border: isSelected ? "2px solid #ffffff" : "1px solid rgba(0,0,0,0.15)",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        color: "#ffffff",
                                                        boxShadow: isSelected ? `0 0 0 2px ${theme.accent}` : "none",
                                                    }}
                                                >
                                                    {isSelected && <Check size={11} strokeWidth={3} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Workspace Skills (if available) */}
                                {availableSkills.length > 0 && (
                                    <div>
                                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: theme.textMuted, marginBottom: 5 }}>
                                            Equip Workspace Skills
                                        </label>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                            {availableSkills.map((sk) => {
                                                const isSelected = selectedSkills.includes(sk.name);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={sk.name}
                                                        onClick={() => toggleSkill(sk.name)}
                                                        style={{
                                                            border: isSelected ? `1px solid ${theme.accent}` : `1px solid ${theme.inputBorder}`,
                                                            background: isSelected ? theme.accentSubtle : theme.inputBg,
                                                            color: isSelected ? theme.accentText : theme.textSecondary,
                                                            borderRadius: 6,
                                                            padding: "3px 8px",
                                                            fontSize: 10.5,
                                                            fontWeight: isSelected ? 700 : 500,
                                                            cursor: "pointer",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 4,
                                                        }}
                                                    >
                                                        {isSelected && <Check size={10} strokeWidth={3} />}
                                                        <span>{sk.name}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 10,
                            paddingTop: 14,
                            borderTop: `1px solid ${theme.borderSubtle}`,
                        }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                background: theme.hoverBg,
                                border: `1px solid ${theme.border}`,
                                color: theme.textSecondary,
                                borderRadius: 8,
                                padding: "8px 16px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            style={{
                                background: theme.accent,
                                border: "none",
                                color: "#ffffff",
                                borderRadius: 8,
                                padding: "8px 18px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                boxShadow: isDarkMode ? "0 2px 8px rgba(16, 185, 129, 0.3)" : "0 2px 6px rgba(39, 109, 96, 0.25)",
                            }}
                        >
                            <Plus size={14} />
                            <span>Create Specialist</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
