import React, { useState } from "react";
import {
    Bot,
    BrainCircuit,
    Check,
    Database,
    Palette,
    Pencil,
    Plus,
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
}

export interface CustomAgentRecord {
    id: string;
    name: string;
    role: string;
    description: string;
    color: string;
    icon: string;
    initialTask?: string;
    createdAt: number;
}

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
}: {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (agent: {
        name: string;
        role: string;
        description: string;
        color: string;
        icon: string;
        initialTask?: string;
    }) => void;
}) {
    const [name, setName] = useState("");
    const [role, setRole] = useState("Specialist");
    const [description, setDescription] = useState("");
    const [color, setColor] = useState("#f59e0b");
    const [icon, setIcon] = useState("dot-eyes");
    const [initialTask, setInitialTask] = useState("");

    if (!isOpen) return null;

    const quickRoles = [
        "Specialist",
        "Researcher",
        "Data Scout",
        "Auditor",
        "Engineer",
    ];

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) return;

        onCreate({
            name: trimmedName,
            role: role.trim() || "Specialist",
            description:
                description.trim() ||
                `Specialist dedicated to ${trimmedName} analysis and data tasks.`,
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
                    maxWidth: 500,
                    boxShadow: "0 20px 40px rgba(23, 61, 59, 0.18)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    animation: "modalFadeIn 0.2s ease-out",
                    fontFamily:
                        "var(--app-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                    color: "#203a37",
                    maxHeight: "90vh",
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
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                background: "#276d60",
                                display: "grid",
                                placeItems: "center",
                                color: "#ffffff",
                            }}
                        >
                            <Sparkles size={15} />
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
                                Configure New Teammate
                            </div>
                            <div style={{ fontSize: 11, color: "#6e8078" }}>
                                Spawn a persistent specialist with an isolated sandbox workspace
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
                        gap: 14,
                    }}
                >
                    {/* Live Preview Banner */}
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
                            name={name || "New Teammate"}
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
                                <span>{name || "Teammate Name"}</span>
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
                                {description || "Purpose and primary tasks..."}
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
                    <div>
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
                            Teammate Name <span style={{ color: "#d97706" }}>*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Churn Analyst, Databricks Auditor"
                            required
                            autoFocus
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

                    {/* Role / Title + Quick Chips */}
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
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                    color: "#566761",
                                }}
                            >
                                Role & Specialization
                            </label>
                            <div style={{ display: "flex", gap: 4 }}>
                                {quickRoles.map((r) => (
                                    <button
                                        type="button"
                                        key={r}
                                        onClick={() => setRole(r)}
                                        style={{
                                            fontSize: 10,
                                            fontWeight: role === r ? 700 : 500,
                                            padding: "1px 6px",
                                            borderRadius: 999,
                                            background: role === r ? "#276d60" : "#eeeae0",
                                            color: role === r ? "#ffffff" : "#4f625b",
                                            border: "none",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <input
                            type="text"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder="e.g. Specialist, Data Scout, Verification"
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 13,
                                color: "#203a37",
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#276d60")}
                            onBlur={(e) => (e.target.style.borderColor = "#d9d4c7")}
                        />
                    </div>

                    {/* Description / Mission */}
                    <div>
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

                    {/* Avatar Icon */}
                    <div>
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
                            Avatar Icon Style
                        </label>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(4, 1fr)",
                                gap: 6,
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
                                            borderRadius: 8,
                                            padding: "6px 4px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: 3,
                                            cursor: "pointer",
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: 20,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontWeight: 800,
                                                fontSize: 15,
                                            }}
                                        >
                                            {typeof IconCmp === "string" ? (
                                                <span>{IconCmp}</span>
                                            ) : (
                                                <IconCmp size={16} />
                                            )}
                                        </div>
                                        <span style={{ fontSize: 10, fontWeight: 600 }}>
                                            {item.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Color Swatch Picker */}
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
                                        width: 20,
                                        height: 20,
                                        padding: 0,
                                        border: "1px solid #d9d4c7",
                                        borderRadius: 5,
                                        cursor: "pointer",
                                        background: "transparent",
                                    }}
                                />
                                <span
                                    style={{
                                        fontFamily: "var(--app-font-mono, monospace)",
                                        fontSize: 10.5,
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
                                            height: 28,
                                            borderRadius: 7,
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
                                                ? "0 0 0 2px #fff, 0 0 0 3px #276d60"
                                                : "none",
                                        }}
                                    >
                                        {isSelected && <Check size={13} strokeWidth={3} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Optional Kickoff Goal / Task */}
                    <div>
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
                            Kickoff Task (Optional)
                        </label>
                        <input
                            type="text"
                            value={initialTask}
                            onChange={(e) => setInitialTask(e.target.value)}
                            placeholder="e.g. Profile sample-data/customer_churn.csv and find risk drivers"
                            style={{
                                width: "100%",
                                background: "#ffffff",
                                border: "1px solid #d9d4c7",
                                borderRadius: 10,
                                padding: "8px 12px",
                                fontSize: 13,
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
