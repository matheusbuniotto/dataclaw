import React, { useState } from "react";
import {
    Bot,
    BrainCircuit,
    Check,
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
import { GrokbotAvatar } from "../pages/AgentsPage";

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
        id: "data_scientist",
        role: "data_scientist",
        title: "Data Scientist",
        tagline: "EDA, Modeling & Statistics",
        description: "Conducts exploratory data analysis, hypothesis testing, and statistical modeling.",
        color: "#8b5cf6",
        icon: "brain",
        capabilities: ["analyst", "data", "coding", "plugins"],
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

// ============================================================================
// Modal to Edit an Existing Agent
// ============================================================================
export function AgentEditorModal({
    agent,
    isOpen,
    onClose,
    onSave,
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
}) {
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
                background: "rgba(23, 40, 36, 0.45)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
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
                    background: "#fffdf8",
                    border: "1px solid #e1ddd2",
                    borderRadius: 18,
                    width: "100%",
                    maxWidth: 480,
                    boxShadow: "0 20px 40px rgba(23, 61, 59, 0.18)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    animation: "modalFadeIn 0.2s ease-out",
                    fontFamily:
                        "var(--app-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                    color: "#203a37",
                }}
            >
                <style>{`
                    @keyframes modalFadeIn {
                        from { opacity: 0; transform: scale(0.96) translateY(8px); }
                        to { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>

                {/* Modal Header */}
                <div
                    style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid #ece7dd",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#fbf9f4",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                background: "#e8f3ee",
                                display: "grid",
                                placeItems: "center",
                                color: "#276d60",
                            }}
                        >
                            <Pencil size={15} />
                        </div>
                        <div>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 14,
                                    color: "#203a37",
                                    lineHeight: 1.2,
                                }}
                            >
                                Customize Teammate
                            </div>
                            <div style={{ fontSize: 11, color: "#6e8078" }}>
                                Personalize avatar, role, and details for {agent.name}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "#8a9a92",
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 6,
                            display: "grid",
                            placeItems: "center",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#203a37")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#8a9a92")}
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSave} style={{ padding: "20px 22px" }}>
                    {/* Live Preview Card */}
                    <div
                        style={{
                            background: "#f4f1e9",
                            border: "1px solid #ded9cb",
                            borderRadius: 12,
                            padding: "12px 14px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            marginBottom: 20,
                        }}
                    >
                        <GrokbotAvatar
                            name={name || agent.name}
                            color={color}
                            icon={icon}
                            size={42}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 14,
                                    color: "#1a332d",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <span>{name || agent.name}</span>
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: "#e0ece5",
                                        color: "#226353",
                                    }}
                                >
                                    {role}
                                </span>
                            </div>
                            <div
                                style={{
                                    fontSize: 11.5,
                                    color: "#5b6e66",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {description || "Role and purpose description"}
                            </div>
                        </div>
                        <span
                            style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: "#e0ece5",
                                color: "#226353",
                                border: "1px solid #c7ded3",
                            }}
                        >
                            Preview
                        </span>
                    </div>

                    {/* Agent Name */}
                    <div style={{ marginBottom: 14 }}>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11.5,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 6,
                            }}
                        >
                            Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Churn Analyst, DataClaw"
                            required
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 13.5,
                                color: "#203a37",
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                            onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                        />
                    </div>

                    {/* Agent Role */}
                    <div style={{ marginBottom: 14 }}>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11.5,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 6,
                            }}
                        >
                            Role / Title
                        </label>
                        <input
                            type="text"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder="e.g. Specialist, Researcher, Data Scout"
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 13.5,
                                color: "#203a37",
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                            onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                        />
                    </div>

                    {/* Agent Purpose & Description */}
                    <div style={{ marginBottom: 16 }}>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11.5,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 6,
                            }}
                        >
                            Role & Description
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe what this agent explores or accomplishes..."
                            rows={2}
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 13,
                                color: "#203a37",
                                outline: "none",
                                resize: "vertical",
                                lineHeight: 1.45,
                                boxSizing: "border-box",
                                fontFamily: "inherit",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                            onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                        />
                    </div>

                    {/* Icon Selection */}
                    <div style={{ marginBottom: 16 }}>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11.5,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 8,
                            }}
                        >
                            Avatar Icon Style
                        </label>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(4, 1fr)",
                                gap: 8,
                            }}
                        >
                            {ICON_OPTIONS.map((item) => {
                                const isSelected = icon === item.id;
                                const IconCmp = item.icon;
                                return (
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => setIcon(item.id)}
                                        style={{
                                            border: isSelected
                                                ? "2px solid #276d60"
                                                : "1px solid #ded9cc",
                                            background: isSelected ? "#eef6f2" : "#ffffff",
                                            color: isSelected ? "#1f584e" : "#4a5d56",
                                            borderRadius: 10,
                                            padding: "8px 6px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: 4,
                                            cursor: "pointer",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: 22,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontWeight: 800,
                                                fontSize: 16,
                                            }}
                                        >
                                            {typeof IconCmp === "string" ? (
                                                <span>{IconCmp}</span>
                                            ) : (
                                                <IconCmp size={18} />
                                            )}
                                        </div>
                                        <span style={{ fontSize: 10.5, fontWeight: 600 }}>
                                            {item.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Color Swatch Picker */}
                    <div style={{ marginBottom: 22 }}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifySelf: "space-between",
                                justifyContent: "space-between",
                                marginBottom: 8,
                            }}
                        >
                            <label
                                style={{
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                }}
                            >
                                Accent Color
                            </label>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    title="Choose custom color"
                                    style={{
                                        width: 22,
                                        height: 22,
                                        padding: 0,
                                        border: "1px solid #d9d4c7",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        background: "transparent",
                                    }}
                                />
                                <span
                                    style={{
                                        fontFamily: "var(--app-font-mono, monospace)",
                                        fontSize: 11,
                                        color: "#6b7c75",
                                    }}
                                >
                                    {color.toUpperCase()}
                                </span>
                            </div>
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(8, 1fr)",
                                gap: 6,
                            }}
                        >
                            {PRESET_COLORS.map((preset) => {
                                const isSelected =
                                    color.toLowerCase() === preset.hex.toLowerCase();
                                return (
                                    <button
                                        type="button"
                                        key={preset.hex}
                                        onClick={() => setColor(preset.hex)}
                                        title={preset.label}
                                        style={{
                                            height: 32,
                                            borderRadius: 8,
                                            background: preset.hex,
                                            border: isSelected
                                                ? "2px solid #1a332d"
                                                : "1px solid rgba(0,0,0,0.12)",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: "#ffffff",
                                            boxShadow: isSelected
                                                ? "0 0 0 2px #fff, 0 0 0 4px #276d60"
                                                : "none",
                                            transition: "transform 0.15s ease",
                                        }}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.transform = "scale(1.08)")
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.transform = "scale(1)")
                                        }
                                    >
                                        {isSelected && <Check size={14} strokeWidth={3} />}
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
                            gap: 10,
                            paddingTop: 14,
                            borderTop: "1px solid #ece7dd",
                        }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                background: "#f2eee5",
                                border: "1px solid #ded8cc",
                                color: "#4f625b",
                                borderRadius: 10,
                                padding: "8px 16px",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            style={{
                                background: "#276d60",
                                border: "none",
                                color: "#fffdf8",
                                borderRadius: 10,
                                padding: "8px 20px",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                                boxShadow: "0 2px 6px rgba(39, 109, 96, 0.25)",
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
// Modal to Configure and Create a New Teammate
// ============================================================================
export function CreateAgentModal({
    isOpen,
    onClose,
    onCreate,
    availableSkills = [],
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
}) {
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
    const [showAdvancedInstructions, setShowAdvancedInstructions] = useState(false);

    if (!isOpen) return null;

    const handleSelectArchetype = (arch: SpecialistArchetype) => {
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

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(23, 40, 36, 0.55)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
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
                    background: "#fffdf8",
                    border: "1px solid #e1ddd2",
                    borderRadius: 18,
                    width: "100%",
                    maxWidth: 580,
                    boxShadow: "0 24px 48px rgba(23, 61, 59, 0.22)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    animation: "modalFadeIn 0.2s ease-out",
                    fontFamily:
                        "var(--app-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                    color: "#203a37",
                    maxHeight: "92vh",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid #ece7dd",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#fbf9f4",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 8,
                                background: "#276d60",
                                display: "grid",
                                placeItems: "center",
                                color: "#ffffff",
                            }}
                        >
                            <Sparkles size={16} />
                        </div>
                        <div>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 14.5,
                                    color: "#203a37",
                                    lineHeight: 1.2,
                                }}
                            >
                                Configure New Specialist Agent
                            </div>
                            <div style={{ fontSize: 11, color: "#6e8078" }}>
                                Customize domain role, toolings, compute sandbox, and operating instructions
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "#8a9a92",
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 6,
                            display: "grid",
                            placeItems: "center",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#203a37")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#8a9a92")}
                    >
                        <X size={18} />
                    </button>
                </div>

                <form
                    onSubmit={handleSubmit}
                    style={{
                        padding: "18px 22px 20px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    {/* Live Preview Card */}
                    <div
                        style={{
                            background: "#f4f1e9",
                            border: "1px solid #ded9cb",
                            borderRadius: 12,
                            padding: "12px 14px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                        }}
                    >
                        <GrokbotAvatar
                            name={name || "New Specialist"}
                            color={color}
                            icon={icon}
                            size={44}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 14,
                                    color: "#1a332d",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    flexWrap: "wrap",
                                }}
                            >
                                <span>{name || "Specialist Name"}</span>
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: "#e0ece5",
                                        color: "#226353",
                                    }}
                                >
                                    {role}
                                </span>
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: computeKind === "docker" ? "#e0f2fe" : "#fef3c7",
                                        color: computeKind === "docker" ? "#0369a1" : "#b45309",
                                    }}
                                >
                                    {computeKind === "docker" ? "Docker Sandbox" : computeKind === "local" ? "Local Agent Home" : "Shared Workspace"}
                                </span>
                            </div>
                            <div
                                style={{
                                    fontSize: 11.5,
                                    color: "#5b6e66",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    marginTop: 2,
                                }}
                            >
                                {description || "Domain mission and analytical tasks..."}
                            </div>
                        </div>
                    </div>

                    {/* Specialist Role Archetypes */}
                    <div>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                color: "#566761",
                                marginBottom: 8,
                            }}
                        >
                            Select Specialist Archetype
                        </label>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                                gap: 6,
                            }}
                        >
                            {SPECIALIST_ARCHETYPES.map((arch) => {
                                const isSelected = selectedArchetypeId === arch.id;
                                return (
                                    <button
                                        type="button"
                                        key={arch.id}
                                        onClick={() => handleSelectArchetype(arch)}
                                        style={{
                                            border: isSelected
                                                ? `2px solid ${arch.color}`
                                                : "1px solid #ded9cc",
                                            background: isSelected ? "#ffffff" : "#f8f6f0",
                                            borderRadius: 9,
                                            padding: "8px 6px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            textAlign: "center",
                                            cursor: "pointer",
                                            boxShadow: isSelected
                                                ? `0 2px 8px ${arch.color}22`
                                                : "none",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: "50%",
                                                background: arch.color,
                                                marginBottom: 4,
                                            }}
                                        />
                                        <span style={{ fontSize: 11, fontWeight: 700, color: "#203a37", lineHeight: 1.2 }}>
                                            {arch.title}
                                        </span>
                                        <span style={{ fontSize: 9, color: "#6b7c75", marginTop: 2, lineHeight: 1.15 }}>
                                            {arch.tagline}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Agent Name & Role Identifier */}
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
                        <div>
                            <label
                                style={{
                                    display: "block",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                    marginBottom: 6,
                                }}
                            >
                                Teammate Name <span style={{ color: "#d97706" }}>*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Churn Scientist, Pipeline Auditor"
                                required
                                style={{
                                    width: "100%",
                                    background: "#ffffff",
                                    border: "1px solid #d9d4c7",
                                    borderRadius: 9,
                                    padding: "8px 11px",
                                    fontSize: 13,
                                    color: "#203a37",
                                    outline: "none",
                                    boxSizing: "border-box",
                                }}
                                onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                                onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                            />
                        </div>
                        <div>
                            <label
                                style={{
                                    display: "block",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                    marginBottom: 6,
                                }}
                            >
                                Role Identifier
                            </label>
                            <input
                                type="text"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                placeholder="e.g. data_scientist, mlops, custom"
                                style={{
                                    width: "100%",
                                    background: "#ffffff",
                                    border: "1px solid #d9d4c7",
                                    borderRadius: 9,
                                    padding: "8px 11px",
                                    fontSize: 13,
                                    fontFamily: "var(--app-font-mono, monospace)",
                                    color: "#203a37",
                                    outline: "none",
                                    boxSizing: "border-box",
                                }}
                                onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                                onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                            />
                        </div>
                    </div>

                    {/* Mission / Description */}
                    <div>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 6,
                            }}
                        >
                            Purpose & Mission
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What data does this agent monitor or explore? What questions will it answer?"
                            rows={2}
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 9,
                                padding: "8px 11px",
                                fontSize: 12.5,
                                color: "#203a37",
                                outline: "none",
                                resize: "vertical",
                                lineHeight: 1.4,
                                boxSizing: "border-box",
                                fontFamily: "inherit",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                            onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                        />
                    </div>

                    {/* Tooling Capabilities Multi-Select */}
                    <div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 6,
                            }}
                        >
                            <label
                                style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                }}
                            >
                                Tooling & Capabilities
                            </label>
                            <span style={{ fontSize: 10, color: "#6b7c75" }}>
                                {capabilities.length} active group{capabilities.length !== 1 ? "s" : ""}
                            </span>
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                                gap: 6,
                            }}
                        >
                            {AVAILABLE_CAPABILITY_OPTIONS.map((cap) => {
                                const isChecked = capabilities.includes(cap.id);
                                return (
                                    <button
                                        type="button"
                                        key={cap.id}
                                        onClick={() => toggleCapability(cap.id)}
                                        style={{
                                            border: isChecked
                                                ? "1.5px solid #276d60"
                                                : "1px solid #ded9cc",
                                            background: isChecked ? "#eef6f2" : "#ffffff",
                                            borderRadius: 8,
                                            padding: "7px 10px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "flex-start",
                                            cursor: "pointer",
                                            textAlign: "left",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                fontWeight: 650,
                                                fontSize: 11.5,
                                                color: isChecked ? "#1f584e" : "#3b4b45",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: 14,
                                                    height: 14,
                                                    borderRadius: 4,
                                                    border: isChecked
                                                        ? "1.5px solid #276d60"
                                                        : "1.5px solid #b5b0a3",
                                                    background: isChecked ? "#276d60" : "transparent",
                                                    display: "grid",
                                                    placeItems: "center",
                                                    color: "#ffffff",
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {isChecked && <Check size={10} strokeWidth={3} />}
                                            </div>
                                            <span>{cap.label}</span>
                                        </div>
                                        <span
                                            style={{
                                                fontSize: 9.5,
                                                color: "#6b7c75",
                                                marginTop: 3,
                                                lineHeight: 1.25,
                                            }}
                                        >
                                            {cap.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Compute Environment Selector */}
                    <div>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 6,
                            }}
                        >
                            Compute & Execution Sandbox
                        </label>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, 1fr)",
                                gap: 8,
                            }}
                        >
                            {[
                                {
                                    kind: "local" as const,
                                    label: "Private Local Directory",
                                    desc: "Isolated cwd at /workspace/agents/<id>",
                                },
                                {
                                    kind: "docker" as const,
                                    label: "Docker Container Sandbox",
                                    desc: "Process & network boundary",
                                },
                                {
                                    kind: "shared" as const,
                                    label: "Shared Workspace",
                                    desc: "Root /workspace directory",
                                },
                            ].map((item) => {
                                const isSelected = computeKind === item.kind;
                                return (
                                    <button
                                        type="button"
                                        key={item.kind}
                                        onClick={() => setComputeKind(item.kind)}
                                        style={{
                                            border: isSelected
                                                ? "1.5px solid #276d60"
                                                : "1px solid #ded9cc",
                                            background: isSelected ? "#eef6f2" : "#ffffff",
                                            borderRadius: 8,
                                            padding: "8px 9px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "flex-start",
                                            textAlign: "left",
                                            cursor: "pointer",
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontSize: 11.5,
                                                fontWeight: 700,
                                                color: isSelected ? "#1f584e" : "#203a37",
                                            }}
                                        >
                                            {item.label}
                                        </span>
                                        <span style={{ fontSize: 9.5, color: "#6b7c75", marginTop: 2 }}>
                                            {item.desc}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Extra Docker options when Docker is active */}
                        {computeKind === "docker" && (
                            <div
                                style={{
                                    marginTop: 8,
                                    padding: "10px 12px",
                                    background: "#f8fafd",
                                    border: "1px solid #d0e1fd",
                                    borderRadius: 8,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                }}
                            >
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                    <div style={{ flex: 1 }}>
                                        <label
                                            style={{
                                                display: "block",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                textTransform: "uppercase",
                                                color: "#0369a1",
                                                marginBottom: 3,
                                            }}
                                        >
                                            Container Image
                                        </label>
                                        <input
                                            type="text"
                                            value={dockerImage}
                                            onChange={(e) => setDockerImage(e.target.value)}
                                            placeholder="oven/bun:1 or python:3.11-slim"
                                            style={{
                                                width: "100%",
                                                padding: "5px 8px",
                                                fontSize: 12,
                                                fontFamily: "var(--app-font-mono, monospace)",
                                                border: "1px solid #b9d5fc",
                                                borderRadius: 6,
                                                background: "#ffffff",
                                                boxSizing: "border-box",
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            style={{
                                                display: "block",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                textTransform: "uppercase",
                                                color: "#0369a1",
                                                marginBottom: 3,
                                            }}
                                        >
                                            Container Network
                                        </label>
                                        <div style={{ display: "flex", gap: 4 }}>
                                            {(["none", "bridge"] as const).map((net) => (
                                                <button
                                                    type="button"
                                                    key={net}
                                                    onClick={() => setDockerNetwork(net)}
                                                    style={{
                                                        padding: "4px 8px",
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        borderRadius: 6,
                                                        border: dockerNetwork === net ? "1px solid #0284c7" : "1px solid #cbd5e1",
                                                        background: dockerNetwork === net ? "#0284c7" : "#ffffff",
                                                        color: dockerNetwork === net ? "#ffffff" : "#475569",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    {net === "none" ? "Offline (none)" : "Internet (bridge)"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Available Skills To Equip (if any) */}
                    {availableSkills.length > 0 && (
                        <div>
                            <label
                                style={{
                                    display: "block",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                    marginBottom: 6,
                                }}
                            >
                                Equip Domain Skills (Optional)
                            </label>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {availableSkills.map((sk) => {
                                    const isSelected = selectedSkills.includes(sk.name);
                                    return (
                                        <button
                                            type="button"
                                            key={sk.name}
                                            onClick={() => toggleSkill(sk.name)}
                                            style={{
                                                border: isSelected
                                                    ? "1px solid #276d60"
                                                    : "1px solid #ded9cc",
                                                background: isSelected ? "#eef6f2" : "#ffffff",
                                                color: isSelected ? "#1f584e" : "#4a5d56",
                                                borderRadius: 6,
                                                padding: "4px 8px",
                                                fontSize: 11,
                                                fontWeight: isSelected ? 700 : 500,
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 4,
                                            }}
                                        >
                                            {isSelected && <Check size={11} strokeWidth={3} />}
                                            <span>{sk.name}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Avatar Icon & Accent Color */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                            <label
                                style={{
                                    display: "block",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                    marginBottom: 6,
                                }}
                            >
                                Avatar Icon Style
                            </label>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(4, 1fr)",
                                    gap: 5,
                                }}
                            >
                                {ICON_OPTIONS.map((item) => {
                                    const isSelected = icon === item.id;
                                    const IconCmp = item.icon;
                                    return (
                                        <button
                                            type="button"
                                            key={item.id}
                                            onClick={() => setIcon(item.id)}
                                            style={{
                                                border: isSelected
                                                    ? "1.5px solid #276d60"
                                                    : "1px solid #ded9cc",
                                                background: isSelected ? "#eef6f2" : "#ffffff",
                                                color: isSelected ? "#1f584e" : "#4a5d56",
                                                borderRadius: 6,
                                                padding: "4px 2px",
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                gap: 2,
                                                cursor: "pointer",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    height: 18,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontWeight: 800,
                                                    fontSize: 13,
                                                }}
                                            >
                                                {typeof IconCmp === "string" ? (
                                                    <span>{IconCmp}</span>
                                                ) : (
                                                    <IconCmp size={14} />
                                                )}
                                            </div>
                                            <span style={{ fontSize: 9, fontWeight: 600 }}>
                                                {item.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    marginBottom: 6,
                                }}
                            >
                                <label
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                        color: "#566761",
                                    }}
                                >
                                    Accent Color
                                </label>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <input
                                        type="color"
                                        value={color}
                                        onChange={(e) => setColor(e.target.value)}
                                        title="Choose custom color"
                                        style={{
                                            width: 18,
                                            height: 18,
                                            padding: 0,
                                            border: "1px solid #d9d4c7",
                                            borderRadius: 4,
                                            cursor: "pointer",
                                            background: "transparent",
                                        }}
                                    />
                                    <span
                                        style={{
                                            fontFamily: "var(--app-font-mono, monospace)",
                                            fontSize: 10,
                                            color: "#6b7c75",
                                        }}
                                    >
                                        {color.toUpperCase()}
                                    </span>
                                </div>
                            </div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(8, 1fr)",
                                    gap: 4,
                                }}
                            >
                                {PRESET_COLORS.map((preset) => {
                                    const isSelected =
                                        color.toLowerCase() === preset.hex.toLowerCase();
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
                                                border: isSelected
                                                    ? "2px solid #1a332d"
                                                    : "1px solid rgba(0,0,0,0.12)",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                color: "#ffffff",
                                                boxShadow: isSelected
                                                    ? "0 0 0 1px #fff, 0 0 0 2px #276d60"
                                                    : "none",
                                            }}
                                        >
                                            {isSelected && <Check size={11} strokeWidth={3} />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Operating Instructions / Persona */}
                    <div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 4,
                            }}
                        >
                            <label
                                style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                }}
                            >
                                System Persona & Operating Instructions
                            </label>
                            <button
                                type="button"
                                onClick={() => setShowAdvancedInstructions(!showAdvancedInstructions)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    color: "#276d60",
                                    cursor: "pointer",
                                    padding: 0,
                                }}
                            >
                                {showAdvancedInstructions ? "Hide details" : "Customize persona"}
                            </button>
                        </div>
                        {showAdvancedInstructions ? (
                            <textarea
                                value={instructions}
                                onChange={(e) => setInstructions(e.target.value)}
                                rows={4}
                                placeholder="Operating instructions for this specialist..."
                                style={{
                                    width: "100%",
                                    background: "#ffffff",
                                    border: "1px solid #d9d4c7",
                                    borderRadius: 9,
                                    padding: "8px 11px",
                                    fontSize: 12,
                                    color: "#203a37",
                                    outline: "none",
                                    resize: "vertical",
                                    lineHeight: 1.45,
                                    boxSizing: "border-box",
                                    fontFamily: "inherit",
                                }}
                                onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                                onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                            />
                        ) : (
                            <div
                                style={{
                                    fontSize: 11,
                                    color: "#6b7c75",
                                    lineHeight: 1.35,
                                    background: "#f9f7f2",
                                    padding: "6px 10px",
                                    borderRadius: 7,
                                    border: "1px dashed #ded9cb",
                                }}
                            >
                                {instructions.slice(0, 140)}...
                            </div>
                        )}
                    </div>

                    {/* Optional Kickoff Goal / Task */}
                    <div>
                        <label
                            style={{
                                display: "block",
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                color: "#566761",
                                marginBottom: 6,
                            }}
                        >
                            Kickoff Task (Optional)
                        </label>
                        <input
                            type="text"
                            value={initialTask}
                            onChange={(e) => setInitialTask(e.target.value)}
                            placeholder="e.g. Profile cohort_retention.csv and test for Simpson's Paradox"
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 9,
                                padding: "8px 11px",
                                fontSize: 12.5,
                                color: "#203a37",
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                            onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                        />
                    </div>

                    {/* Actions */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 10,
                            paddingTop: 12,
                            borderTop: "1px solid #ece7dd",
                        }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                background: "#f2eee5",
                                border: "1px solid #ded8cc",
                                color: "#4f625b",
                                borderRadius: 9,
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
                                background: "#276d60",
                                border: "none",
                                color: "#fffdf8",
                                borderRadius: 9,
                                padding: "8px 20px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                boxShadow: "0 2px 6px rgba(39, 109, 96, 0.25)",
                            }}
                        >
                            <Plus size={15} />
                            <span>Create Teammate</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
