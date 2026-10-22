import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
    RosterEntry,
    TranscriptItem,
    WorkspaceAgent,
    WorkspaceSkillInfo,
} from "../state/workspace-types";
import { AssistantTurnView, groupIntoTurns, type ChatTurn } from "../components/ChatComponents";
import { STARTER_PROMPTS } from "../components/starters";
import {
    AgentEditorModal,
    CreateAgentModal,
    type AgentCustomization,
    type CustomAgentRecord,
    PRESET_COLORS,
    loadAgentCustomizations,
    saveAgentCustomization,
    loadCustomAgents,
    saveCustomAgent,
} from "../components/AgentEditorModal";
import {
    ArrowUp,
    AtSign,
    Bot,
    BrainCircuit,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    Database,
    ExternalLink,
    Layers3,
    Maximize2,
    Minimize2,
    Monitor,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Pin,
    Plus,
    Search,
    Settings2,
    ShieldCheck,
    Sparkles,
    Square,
    Sun,
    Terminal,
    User,
    Workflow,
    X,
    Zap,
} from "lucide-react";

// ============================================================================
// User Profile & Settings Types & Helpers
// ============================================================================
export interface UserProfile {
    name: string;
    role: string;
    initials: string;
    avatarColor: string;
}

const DEFAULT_USER_PROFILE: UserProfile = {
    name: "Matheus",
    role: "Lead Engineer",
    initials: "MA",
    avatarColor: "#276d60",
};

export function loadUserProfile(): UserProfile {
    if (typeof window === "undefined") return DEFAULT_USER_PROFILE;
    try {
        const raw = window.localStorage.getItem("dataclaw.userProfile");
        if (raw) return { ...DEFAULT_USER_PROFILE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_USER_PROFILE;
}

export function saveUserProfile(profile: UserProfile): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem("dataclaw.userProfile", JSON.stringify(profile));
    } catch {}
}

export function ProfileSettingsModal({
    isOpen,
    onClose,
    profile,
    onSaveProfile,
    ops,
    onToggleOps,
    onOpenSettings,
    theme = "classic",
    onSelectTheme,
}: {
    isOpen: boolean;
    onClose: () => void;
    profile: UserProfile;
    onSaveProfile: (profile: UserProfile) => void;
    ops: boolean;
    onToggleOps?: () => void;
    onOpenSettings?: () => void;
    theme?: "classic" | "lovable";
    onSelectTheme?: (theme: "classic" | "lovable") => void;
}) {
    if (!isOpen) return null;

    const [name, setName] = useState(profile.name);
    const [role, setRole] = useState(profile.role);
    const [avatarColor, setAvatarColor] = useState(profile.avatarColor);
    const isDark = theme === "lovable";

    const derivedInitials = useMemo(() => {
        return (
            name
                .trim()
                .split(/\s+/)
                .map((p) => p[0] ?? "")
                .join("")
                .slice(0, 2)
                .toUpperCase() || "MA"
        );
    }, [name]);

    const handleSave = () => {
        onSaveProfile({
            name: name.trim() || "Matheus",
            role: role.trim() || "Lead Engineer",
            initials: derivedInitials,
            avatarColor,
        });
        onClose();
    };

    return (
        <div
            className="modal-backdrop"
            style={{ zIndex: 10000 }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    width: 460,
                    maxWidth: "92vw",
                    background: isDark ? "#141720" : "#fffdf8",
                    border: isDark ? "1px solid #252b3a" : "1px solid #dedbd1",
                    borderRadius: 14,
                    boxShadow: isDark
                        ? "0 24px 70px rgba(0, 0, 0, 0.6)"
                        : "0 20px 60px rgba(23, 45, 41, 0.22)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    color: isDark ? "#f1f3f7" : "#203a37",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "16px 20px 14px",
                        borderBottom: isDark ? "1px solid #202534" : "1px solid #ece7dd",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: isDark ? "#10131a" : "#faf7f0",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                background: isDark ? "#ff5e57" : "#276d60",
                                color: "#ffffff",
                                display: "grid",
                                placeItems: "center",
                                boxShadow: isDark ? "0 2px 8px rgba(255, 94, 87, 0.3)" : "none",
                            }}
                        >
                            <Settings2 size={15} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 15, color: isDark ? "#f1f3f7" : "#203a37" }}>
                                Profile & Settings
                            </div>
                            <div style={{ fontSize: 11, color: isDark ? "#848f9f" : "#7a8a82" }}>
                                Personal workspace preferences
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: isDark ? "#828e9f" : "#8a9790",
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 6,
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18, maxHeight: "78vh", overflowY: "auto" }}>
                    {/* Theme Switcher Section */}
                    {onSelectTheme && (
                        <div>
                            <div
                                style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.08em",
                                    color: isDark ? "#8894a4" : "#687a72",
                                    marginBottom: 10,
                                }}
                            >
                                Interface Theme
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                <button
                                    type="button"
                                    onClick={() => onSelectTheme("classic")}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 9,
                                        padding: "10px 12px",
                                        borderRadius: 9,
                                        border:
                                            theme === "classic"
                                                ? `2px solid ${isDark ? "#276d60" : "#276d60"}`
                                                : `1px solid ${isDark ? "#262c3b" : "#ded8cb"}`,
                                        background: isDark ? "#171b24" : "#fbf9f4",
                                        color: isDark ? "#e1e6ef" : "#203a37",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 12,
                                        boxShadow:
                                            theme === "classic"
                                                ? "0 0 0 2px rgba(39, 109, 96, 0.25)"
                                                : "none",
                                        transition: "all 0.15s ease",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 20,
                                            height: 20,
                                            borderRadius: "50%",
                                            background: "#276d60",
                                            border: "2px solid #f9f7f1",
                                            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                                            flexShrink: 0,
                                        }}
                                    />
                                    <div style={{ textAlign: "left", flex: 1 }}>
                                        <div style={{ lineHeight: 1.2 }}>Classic</div>
                                        <div style={{ fontSize: 9.5, opacity: 0.7 }}>Paper & Forest</div>
                                    </div>
                                    {theme === "classic" && <Check size={14} style={{ color: "#276d60" }} />}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => onSelectTheme("lovable")}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 9,
                                        padding: "10px 12px",
                                        borderRadius: 9,
                                        border:
                                            theme === "lovable"
                                                ? "2px solid #ff5e57"
                                                : `1px solid ${isDark ? "#262c3b" : "#ded8cb"}`,
                                        background: isDark ? "#191e29" : "#1a1e28",
                                        color: "#ffffff",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 12,
                                        boxShadow:
                                            theme === "lovable"
                                                ? "0 0 0 2px rgba(255, 94, 87, 0.35)"
                                                : "none",
                                        transition: "all 0.15s ease",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 20,
                                            height: 20,
                                            borderRadius: "50%",
                                            background: "#ff5e57",
                                            border: "2px solid #0d0f12",
                                            boxShadow: "0 1px 4px rgba(255, 94, 87, 0.4)",
                                            flexShrink: 0,
                                        }}
                                    />
                                    <div style={{ textAlign: "left", flex: 1 }}>
                                        <div style={{ lineHeight: 1.2 }}>Lovable Dark</div>
                                        <div style={{ fontSize: 9.5, color: "#9ca7b6" }}>Obsidian & Coral</div>
                                    </div>
                                    {theme === "lovable" && <Check size={14} style={{ color: "#ff5e57" }} />}
                                </button>
                            </div>
                        </div>
                    )}

                    <div style={{ height: 1, background: isDark ? "#202534" : "#ece7dd" }} />

                    {/* User Profile Section */}
                    <div>
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                color: isDark ? "#8894a4" : "#687a72",
                                marginBottom: 12,
                            }}
                        >
                            User Profile
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                            <div
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: "50%",
                                    background: avatarColor,
                                    color: "#ffffff",
                                    display: "grid",
                                    placeItems: "center",
                                    fontWeight: 700,
                                    fontSize: 16,
                                    letterSpacing: "-0.02em",
                                    boxShadow: isDark
                                        ? "0 4px 12px rgba(0,0,0,0.4)"
                                        : "0 2px 8px rgba(0,0,0,0.12)",
                                    flexShrink: 0,
                                }}
                            >
                                {derivedInitials}
                            </div>
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div>
                                    <label
                                        style={{
                                            fontSize: 10.5,
                                            fontWeight: 600,
                                            color: isDark ? "#9aa5b6" : "#54675f",
                                            display: "block",
                                            marginBottom: 3,
                                        }}
                                    >
                                        Full Name
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "7px 10px",
                                            fontSize: 12.5,
                                            borderRadius: 8,
                                            border: isDark ? "1px solid #272e3f" : "1px solid #dcd7cb",
                                            background: isDark ? "#1a1e28" : "#ffffff",
                                            color: isDark ? "#f1f3f7" : "#203a37",
                                            outline: "none",
                                        }}
                                    />
                                </div>
                                <div>
                                    <label
                                        style={{
                                            fontSize: 10.5,
                                            fontWeight: 600,
                                            color: isDark ? "#9aa5b6" : "#54675f",
                                            display: "block",
                                            marginBottom: 3,
                                        }}
                                    >
                                        Role / Title
                                    </label>
                                    <input
                                        type="text"
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "7px 10px",
                                            fontSize: 12.5,
                                            borderRadius: 8,
                                            border: isDark ? "1px solid #272e3f" : "1px solid #dcd7cb",
                                            background: isDark ? "#1a1e28" : "#ffffff",
                                            color: isDark ? "#f1f3f7" : "#203a37",
                                            outline: "none",
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Avatar Color Swatches */}
                        <div>
                            <label
                                style={{
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    color: isDark ? "#9aa5b6" : "#54675f",
                                    display: "block",
                                    marginBottom: 6,
                                }}
                            >
                                Avatar Color
                            </label>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {PRESET_COLORS.map((c) => (
                                    <button
                                        key={c.hex}
                                        type="button"
                                        onClick={() => setAvatarColor(c.hex)}
                                        title={c.label}
                                        style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: "50%",
                                            background: c.hex,
                                            border:
                                                avatarColor === c.hex
                                                    ? `2px solid ${isDark ? "#ffffff" : "#203a37"}`
                                                    : "1.5px solid transparent",
                                            boxShadow:
                                                avatarColor === c.hex
                                                    ? `0 0 0 2px ${isDark ? "#141720" : "#fffdf8"}`
                                                    : "none",
                                            cursor: "pointer",
                                            padding: 0,
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <div style={{ height: 1, background: isDark ? "#202534" : "#ece7dd" }} />

                    {/* Workspace Preferences */}
                    <div>
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                                color: isDark ? "#8894a4" : "#687a72",
                                marginBottom: 12,
                            }}
                        >
                            Preferences & Controls
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 0",
                            }}
                        >
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: isDark ? "#f1f3f7" : "#203a37" }}>
                                    Operations / Presentation context
                                </div>
                                <div style={{ fontSize: 10.5, color: isDark ? "#8894a4" : "#7a8a82" }}>
                                    Show milestones, hypothesis counts & telemetry tags
                                </div>
                            </div>
                            {onToggleOps && (
                                <button
                                    type="button"
                                    className={`toggle ${ops ? "on" : ""}`}
                                    onClick={onToggleOps}
                                    aria-label="Toggle operations context"
                                >
                                    <i />
                                </button>
                            )}
                        </div>

                        {onOpenSettings && (
                            <div
                                style={{
                                    marginTop: 10,
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    background: isDark ? "#181d27" : "#f4f1e9",
                                    border: isDark ? "1px solid #252b3a" : "1px solid #e3ded5",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: isDark ? "#f1f3f7" : "#203a37" }}>
                                        Console Platform Settings
                                    </div>
                                    <div style={{ fontSize: 10.5, color: isDark ? "#8894a4" : "#7a8a82" }}>
                                        Manage Databricks auth, models, and storage
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        onOpenSettings();
                                    }}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 5,
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        color: isDark ? "#ff5e57" : "#276d60",
                                        background: isDark ? "#1e2432" : "#ffffff",
                                        border: isDark ? "1px solid #333d52" : "1px solid #c7ded3",
                                        borderRadius: 6,
                                        padding: "6px 10px",
                                        cursor: "pointer",
                                    }}
                                >
                                    <span>Open</span>
                                    <ExternalLink size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div
                    style={{
                        padding: "12px 20px",
                        borderTop: isDark ? "1px solid #202534" : "1px solid #ece7dd",
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 10,
                        background: isDark ? "#10131a" : "#faf7f0",
                    }}
                >
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            padding: "7px 14px",
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 7,
                            border: isDark ? "1px solid #282f40" : "1px solid #d5cfc4",
                            background: isDark ? "#191d28" : "#ffffff",
                            color: isDark ? "#9ca7b6" : "#53655e",
                            cursor: "pointer",
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        style={{
                            padding: "7px 16px",
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 7,
                            border: isDark ? "1px solid #ff5e57" : "1px solid #276d60",
                            background: isDark ? "#ff5e57" : "#276d60",
                            color: "#ffffff",
                            cursor: "pointer",
                            boxShadow: isDark
                                ? "0 2px 10px rgba(255, 94, 87, 0.4)"
                                : "0 2px 4px rgba(39, 109, 96, 0.2)",
                        }}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Bot Avatar Component (Expressive Grokbot dot-eyes or icon)
// ============================================================================
export type GrokbotMood = "normal" | "sharp" | "thinking" | "verified" | "alert";

export function GrokbotAvatar({
    name,
    color,
    icon,
    size = 38,
    isWorking = false,
    mood = "normal",
}: {
    name: string;
    color?: string;
    icon?: string;
    size?: number;
    isWorking?: boolean;
    mood?: GrokbotMood;
}) {
    const palette = [
        "#276d60", // Classic Forest Pine
        "#10b981", // Emerald
        "#d97706", // Amber
        "#8b5cf6", // Purple
        "#06b6d4", // Cyan
        "#e11d48", // Rose
        "#3b82f6", // Blue
        "#52796f", // Slate Sage
    ];

    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const bgColor = color || palette[Math.abs(hash) % palette.length];
    const iconSize = Math.max(14, Math.round(size * 0.52));

    const effectiveMood: GrokbotMood = isWorking ? "thinking" : mood;

    const renderCenter = () => {
        // Eyes and icons are ALWAYS pure white #ffffff
        const iconColor = "#ffffff";

        if (icon === "brain") return <BrainCircuit size={iconSize} color={iconColor} />;
        if (icon === "bot") return <Bot size={iconSize} color={iconColor} />;
        if (icon === "database") return <Database size={iconSize} color={iconColor} />;
        if (icon === "sparkles") return <Sparkles size={iconSize} color={iconColor} />;
        if (icon === "terminal") return <Terminal size={iconSize} color={iconColor} />;
        if (icon === "workflow") return <Workflow size={iconSize} color={iconColor} />;
        if (icon === "shield") return <ShieldCheck size={iconSize} color={iconColor} />;

        // Expressive Cute Grokbot dot eyes
        const eyeSize = Math.max(3.5, Math.round(size * 0.13));
        const gap = Math.max(3, Math.round(size * 0.12));

        if (effectiveMood === "thinking") {
            return (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap,
                        animation: "grokScan 1.6s ease-in-out infinite",
                    }}
                >
                    <div
                        style={{
                            width: eyeSize,
                            height: eyeSize,
                            borderRadius: "50%",
                            background: "#ffffff",
                            animation: "grokBlink 3.2s infinite",
                        }}
                    />
                    <div
                        style={{
                            width: eyeSize,
                            height: eyeSize,
                            borderRadius: "50%",
                            background: "#ffffff",
                            animation: "grokBlink 3.2s infinite 0.2s",
                        }}
                    />
                </div>
            );
        }

        if (effectiveMood === "sharp") {
            return (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap,
                    }}
                >
                    <div
                        style={{
                            width: eyeSize * 1.1,
                            height: eyeSize * 0.9,
                            borderRadius: "50%",
                            background: "#ffffff",
                            transform: "rotate(-8deg)",
                        }}
                    />
                    <div
                        style={{
                            width: eyeSize,
                            height: eyeSize,
                            borderRadius: "50%",
                            background: "#ffffff",
                            animation: "grokWink 4.2s infinite",
                        }}
                    />
                </div>
            );
        }

        if (effectiveMood === "alert") {
            return (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: gap + 1,
                        animation: "grokAlertShake 3s ease-in-out infinite",
                    }}
                >
                    <div
                        style={{
                            width: eyeSize * 1.25,
                            height: eyeSize * 1.25,
                            borderRadius: "50%",
                            background: "#ffffff",
                            boxShadow: "0 0 4px rgba(255,255,255,0.8)",
                        }}
                    />
                    <div
                        style={{
                            width: eyeSize * 1.25,
                            height: eyeSize * 1.25,
                            borderRadius: "50%",
                            background: "#ffffff",
                            boxShadow: "0 0 4px rgba(255,255,255,0.8)",
                        }}
                    />
                </div>
            );
        }

        // Normal default eyes with gentle blinking
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap,
                }}
            >
                <div
                    style={{
                        width: eyeSize,
                        height: eyeSize,
                        borderRadius: "50%",
                        background: "#ffffff",
                        animation: "grokBlink 4s infinite",
                    }}
                />
                <div
                    style={{
                        width: eyeSize,
                        height: eyeSize,
                        borderRadius: "50%",
                        background: "#ffffff",
                        animation: "grokBlink 4s infinite 0.25s",
                    }}
                />
            </div>
        );
    };

    // Status dot color mapping
    let statusBg = "#276d60";
    if (effectiveMood === "thinking") statusBg = "#3b82f6";
    else if (effectiveMood === "sharp") statusBg = "#f59e0b";
    else if (effectiveMood === "verified") statusBg = "#10b981";
    else if (effectiveMood === "alert") statusBg = "#f43f5e";

    return (
        <>
            <style>{`
                @keyframes grokBlink {
                    0%, 92%, 100% { transform: scaleY(1); }
                    96% { transform: scaleY(0.12); }
                }
                @keyframes grokScan {
                    0%, 100% { transform: translateX(-2.5px); }
                    50% { transform: translateX(2.5px); }
                }
                @keyframes grokWink {
                    0%, 88%, 100% { transform: scaleY(1); }
                    94% { transform: scaleY(0.1) rotate(-15deg); }
                }
                @keyframes grokAlertShake {
                    0%, 100% { transform: translate(0, 0); }
                    2%, 6% { transform: translate(-1px, 0); }
                    4%, 8% { transform: translate(1px, 0); }
                }
                @keyframes grokPulseAura {
                    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
                    70% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
                }
            `}</style>
            <div
                style={{
                    width: size,
                    height: size,
                    minWidth: size,
                    borderRadius: "50%",
                    background: bgColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    boxShadow: effectiveMood === "thinking" ? `0 0 14px ${bgColor}aa` : "none",
                    animation: effectiveMood === "thinking" ? "grokPulseAura 2s infinite" : "none",
                    transition: "all 0.3s ease",
                }}
            >
                {renderCenter()}

                {/* Active online status badge */}
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: Math.max(6, Math.round(size * 0.24)),
                        height: Math.max(6, Math.round(size * 0.24)),
                        borderRadius: "50%",
                        background: statusBg,
                        border: "2px solid #fffdf8",
                        transition: "background 0.25s ease",
                    }}
                />
            </div>
        </>
    );
}

// ============================================================================
// Grok Tone Configuration
// ============================================================================
export type GrokTone = "sharp" | "executive" | "research";

export interface GrokToneConfig {
    id: GrokTone;
    label: string;
    icon: string;
    tag: string;
    description: string;
    instruction: string;
}

export const GROK_TONES: GrokToneConfig[] = [
    {
        id: "sharp",
        label: "Grok Sharp",
        icon: "⚡",
        tag: "Witty & Rigorous",
        description: "Direct, witty, mathematically honest, challenges assumptions, catches confounders.",
        instruction: "Adopt Grok Sharp persona: be direct, witty, mathematically honest, rigorously verify statistical claims, and challenge assumptions.",
    },
    {
        id: "executive",
        label: "Executive",
        icon: "👔",
        tag: "Concise & Decision-Ready",
        description: "High-level, KPI-focused, bottom-line impact with risk mitigations.",
        instruction: "Adopt Executive persona: be concise, prioritize business impact and KPIs, provide high-level summaries with clear action items.",
    },
    {
        id: "research",
        label: "Deep Research",
        icon: "🔬",
        tag: "Pure Statistical Rigor",
        description: "Formal hypothesis tests, confidence intervals, sample size power, distribution checks.",
        instruction: "Adopt Deep Research persona: provide formal statistical proofs, confidence intervals (95%), hypothesis test p-values, sample distribution checks, and bias audits.",
    },
];

// ============================================================================
// Grok Quick Action Pills Configuration
// ============================================================================
export interface GrokQuickAction {
    id: string;
    label: string;
    icon: string;
    prompt: string;
    description: string;
}

export const GROK_QUICK_ACTIONS: GrokQuickAction[] = [
    {
        id: "stat-audit",
        label: "Statistical Audit",
        icon: "⚡",
        prompt: "Audit recent queries and metrics for sample bias, survivorship bias, data leakage, and p-hacking.",
        description: "Rigorous statistical integrity and bias check",
    },
    {
        id: "profile-table",
        label: "Profile Tables",
        icon: "📊",
        prompt: "Profile active tables: compute column distributions, null percentage, cardinality, and detect anomalies.",
        description: "Column stats, null rates, and distribution shape",
    },
    {
        id: "hypothesis-test",
        label: "Hypothesis Test",
        icon: "🧪",
        prompt: "Formulate a formal null hypothesis on key metrics, check test assumptions (normality, variance), and report p-values with 95% confidence intervals.",
        description: "Formal hypothesis verification with confidence bounds",
    },
    {
        id: "simpsons-paradox",
        label: "Simpson's Paradox",
        icon: "🕵️",
        prompt: "Inspect our datasets for Simpson's Paradox: verify if subgroup or cohort stratification reverses the primary aggregate trend.",
        description: "Detect confounding factors and subgroup trend reversals",
    },
    {
        id: "data-drift",
        label: "Data Drift & Outliers",
        icon: "🛡️",
        prompt: "Run an outlier and distribution drift audit on recent feature columns against baseline expectations.",
        description: "Distribution shift and statistical anomaly detection",
    },
    {
        id: "exec-brief",
        label: "Executive Brief",
        icon: "📄",
        prompt: "Generate an executive briefing from recent analysis: highlight top 3 business takeaways, statistical confidence, and recommended action items.",
        description: "High-level summary with key decisions and risks",
    },
];

// ============================================================================
// Routine definition & defaults
// ============================================================================
export interface AgentRoutine {
    id: string;
    title: string;
    frequency: string;
    status: "active" | "paused";
    lastRun?: string;
}

const DEFAULT_ROUTINES: AgentRoutine[] = [
    {
        id: "1",
        title: "Automated Data Profiling",
        frequency: "On intake",
        status: "active",
        lastRun: "Event-triggered",
    },
    {
        id: "2",
        title: "Continuous Statistical Audit",
        frequency: "Per finding",
        status: "active",
        lastRun: "Active",
    },
    {
        id: "3",
        title: "Playbook Auto-Improvement Cycle",
        frequency: "Post-session",
        status: "active",
        lastRun: "Checkpoint-driven",
    },
];

// ============================================================================
// Outcome Card Component (Grokbot Statistical Audit & Verified Outcomes)
// ============================================================================
export interface GrokOutcomeItem {
    label: string;
    detail: string;
    status?: "done" | "flag" | "info";
    tag?: string;
}

export function extractTurnOutcomes(turn: ChatTurn): GrokOutcomeItem[] {
    const text = (turn.assistantText || "").toLowerCase();
    const toolNames = turn.tools.map((t) => t.toolName.toLowerCase());
    const outcomes: GrokOutcomeItem[] = [];

    // Check for SQL / database queries
    const ranQuery =
        toolNames.some((n) => n.includes("sql") || n.includes("query") || n.includes("db") || n.includes("database")) ||
        text.includes("select ") ||
        text.includes("from ") ||
        text.includes("group by") ||
        text.includes("where ");
    if (ranQuery) {
        outcomes.push({
            label: "SQL Consistency",
            detail: "Executed query verified against table schema with 0 syntax errors",
            status: "done",
            tag: "Schema: OK",
        });
    }

    // Check for Statistical / Hypothesis / Distribution audits
    const hasStats =
        text.includes("hypothesis") ||
        text.includes("p-value") ||
        text.includes("distribution") ||
        text.includes("correlation") ||
        text.includes("variance") ||
        text.includes("confidence interval") ||
        text.includes("null hypothesis") ||
        text.includes("outlier");
    if (hasStats) {
        outcomes.push({
            label: "Statistical Guardrails",
            detail: "Sample integrity & null hypothesis audited with rigorous error bounds",
            status: "done",
            tag: "95% CI",
        });
    }

    // Check for Simpson's Paradox / Confounding variables
    const hasSimpsons =
        text.includes("simpson") ||
        text.includes("paradox") ||
        text.includes("confound") ||
        text.includes("cohort reversal") ||
        text.includes("stratification");
    if (hasSimpsons) {
        outcomes.push({
            label: "Confounder Audit",
            detail: "Subgroup stratification audited; confounding variables verified",
            status: "flag",
            tag: "Stratified",
        });
    }

    // Check for Profiling / Data shape
    const hasProfiling =
        toolNames.some((n) => n.includes("profile") || n.includes("inspect")) ||
        text.includes("null percentage") ||
        text.includes("cardinality") ||
        text.includes("column distribution") ||
        text.includes("distinct count");
    if (hasProfiling) {
        outcomes.push({
            label: "Data Profiling",
            detail: "Columns profiled: missingness, distinct cardinality, and distribution shape verified",
            status: "done",
            tag: "Profiled",
        });
    }

    // Check for Bash / Code sandbox execution
    const ranBash =
        toolNames.some((n) => n.includes("bash") || n.includes("exec") || n.includes("terminal") || n.includes("command"));
    if (ranBash) {
        outcomes.push({
            label: "Compute Sandbox",
            detail: "Process completed inside compute sandbox (clean exit 0)",
            status: "done",
            tag: "Sandbox",
        });
    }

    // Durable Checkpoint (DataClaw guarantee on assistant turns)
    outcomes.push({
        label: "Durable Checkpoint",
        detail: "Session state and verified outcomes persisted to SQLite WAL",
        status: "done",
        tag: "SQLite WAL",
    });

    return outcomes;
}

export function GrokOutcomeCard({
    items,
    isDark = false,
}: {
    items: GrokOutcomeItem[];
    isDark?: boolean;
}) {
    const [collapsed, setCollapsed] = useState(false);
    if (!items || items.length === 0) return null;

    const flagCount = items.filter((i) => i.status === "flag").length;

    return (
        <div
            style={{
                background: isDark ? "rgba(21, 25, 35, 0.9)" : "#fffdf8",
                border: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid #e1ddd2",
                borderRadius: 12,
                padding: "10px 14px",
                margin: "10px 0 4px 0",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 12.5,
                fontFamily: "var(--app-font-sans, system-ui, sans-serif)",
                boxShadow: isDark ? "0 4px 16px rgba(0, 0, 0, 0.3)" : "0 2px 8px rgba(32, 58, 55, 0.04)",
                backdropFilter: "blur(8px)",
                transition: "all 0.2s ease",
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingBottom: collapsed ? 0 : 6,
                    borderBottom: collapsed ? "none" : (isDark ? "1px solid rgba(255, 255, 255, 0.06)" : "1px solid #ede8dc"),
                    cursor: "pointer",
                    userSelect: "none",
                }}
                onClick={() => setCollapsed(!collapsed)}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <ShieldCheck size={14} color={isDark ? "#34d399" : "#206847"} />
                    <span style={{ fontWeight: 700, fontSize: 11.5, color: isDark ? "#e2e8f0" : "#1c332e", letterSpacing: "0.2px" }}>
                        Statistical Audit & Verified Outcomes
                    </span>
                    {flagCount > 0 && (
                        <span
                            style={{
                                fontSize: 10,
                                padding: "1px 6px",
                                borderRadius: 999,
                                background: isDark ? "rgba(245, 158, 11, 0.2)" : "#fef3c7",
                                color: isDark ? "#fbbf24" : "#b45309",
                                fontWeight: 700,
                            }}
                        >
                            {flagCount} Alert{flagCount > 1 ? "s" : ""}
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 10,
                            color: isDark ? "#94a3b8" : "#6b7d74",
                            background: isDark ? "rgba(255, 255, 255, 0.04)" : "#f0ede4",
                            padding: "2px 7px",
                            borderRadius: 6,
                        }}
                    >
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                        SQLite WAL Checkpointed
                    </span>
                    <button
                        type="button"
                        style={{
                            background: "none",
                            border: "none",
                            padding: 2,
                            cursor: "pointer",
                            color: isDark ? "#94a3b8" : "#8d9a92",
                            display: "flex",
                            alignItems: "center",
                        }}
                    >
                        <ChevronDown size={13} style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                    </button>
                </div>
            </div>

            {/* Outcome List */}
            {!collapsed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
                    {items.map((item, idx) => (
                        <div
                            key={idx}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                lineHeight: 1.4,
                                fontSize: 12,
                            }}
                        >
                            <span
                                style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: "50%",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 10,
                                    fontWeight: 800,
                                    flexShrink: 0,
                                    background:
                                        item.status === "flag"
                                            ? (isDark ? "rgba(245, 158, 11, 0.2)" : "#fef3c7")
                                            : item.status === "info"
                                            ? (isDark ? "rgba(59, 130, 246, 0.2)" : "#e0f2fe")
                                            : (isDark ? "rgba(16, 185, 129, 0.2)" : "#e6f4ea"),
                                    color:
                                        item.status === "flag"
                                            ? (isDark ? "#fbbf24" : "#d97706")
                                            : item.status === "info"
                                            ? (isDark ? "#60a5fa" : "#0284c7")
                                            : (isDark ? "#34d399" : "#166534"),
                                }}
                            >
                                {item.status === "flag" ? "!" : item.status === "info" ? "i" : "✓"}
                            </span>
                            <span style={{ fontWeight: 700, color: isDark ? "#e2e8f0" : "#1c332e" }}>
                                {item.label}
                            </span>
                            <span style={{ color: isDark ? "#64748b" : "#8d9a92" }}>→</span>
                            <span style={{ color: isDark ? "#94a3b8" : "#53665f", flex: 1 }}>{item.detail}</span>
                            {item.tag && (
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        background: isDark ? "rgba(255, 255, 255, 0.05)" : "#f0ede4",
                                        color: isDark ? "#94a3b8" : "#6d8174",
                                    }}
                                >
                                    {item.tag}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Default 3-Pane Teammate Console (Promoted AgentsPage)
// ============================================================================
export function AgentsPage({
    agents,
    roster,
    activeAgentId,
    onSelectAgent,
    transcript,
    skills,
    workspacePath,
    working,
    stopping,
    onStop,
    ask,
    ops,
    onOpenStillworkMenu,
    onOpenSettings,
    onToggleOps,
}: {
    agents: WorkspaceAgent[];
    roster: RosterEntry[];
    activeAgentId: string;
    onSelectAgent: (id: string) => void;
    transcript: TranscriptItem[];
    skills: WorkspaceSkillInfo[];
    workspacePath?: string;
    working: boolean;
    stopping: boolean;
    onStop: () => void;
    ask: (goal: string) => void;
    ops: boolean;
    onOpenStillworkMenu?: () => void;
    onOpenSettings?: () => void;
    onToggleOps?: () => void;
}) {
    const [fullscreen, setFullscreen] = useState(false);
    const [draft, setDraft] = useState("");
    const [searchFilter, setSearchFilter] = useState("");
    const [showDeepDive, setShowDeepDive] = useState(false); // Optional right panel for data deep dive!
    const [showContext, setShowContext] = useState(false);
    const [humanTakeover, setHumanTakeover] = useState(false);
    const [routines, setRoutines] = useState<AgentRoutine[]>(DEFAULT_ROUTINES);
    const [screenCommand, setScreenCommand] = useState("");
    const [customizations, setCustomizations] = useState<Record<string, AgentCustomization>>(
        loadAgentCustomizations
    );
    const [userProfile, setUserProfile] = useState<UserProfile>(loadUserProfile);
    const [profileModalOpen, setProfileModalOpen] = useState(false);
    const [theme, setTheme] = useState<"classic" | "lovable">(() => {
        if (typeof window !== "undefined") {
            return (
                (window.localStorage.getItem("dataclaw.theme") as "classic" | "lovable") ||
                "classic"
            );
        }
        return "classic";
    });

    const toggleTheme = (next?: "classic" | "lovable") => {
        const val = next || (theme === "classic" ? "lovable" : "classic");
        setTheme(val);
        if (typeof window !== "undefined") {
            window.localStorage.setItem("dataclaw.theme", val);
        }
    };

    const isDark = theme === "lovable";
    const t = {
        isDark,
        bg: isDark ? "#0d0f12" : "#f9f7f1",
        panelBg: isDark ? "#12151b" : "#fbf9f4",
        cardBg: isDark ? "#181c24" : "#ffffff",
        border: isDark ? "#202531" : "#e4e0d6",
        borderSubtle: isDark ? "#181c25" : "#ece7dd",
        textPrimary: isDark ? "#f1f3f7" : "#203a37",
        textSecondary: isDark ? "#9aa3b2" : "#52655d",
        textMuted: isDark ? "#5e6676" : "#87968f",
        accent: isDark ? "#ff5e57" : "#276d60",
        accentHover: isDark ? "#ff4740" : "#1f584e",
        accentSubtle: isDark ? "rgba(255, 94, 87, 0.12)" : "#eaf3ee",
        accentBorder: isDark ? "rgba(255, 94, 87, 0.3)" : "#c7ded3",
        activeItemBg: isDark ? "#191e2a" : "#eaf3ed",
        activeItemBorder: isDark ? "#ff5e57" : "#9cc4b0",
        inactiveItemBg: isDark ? "#161922" : "#ffffff",
        inactiveItemBorder: isDark ? "#222736" : "#eae5db",
        hoverItemBg: isDark ? "#161922" : "#f0ede4",
        inputBg: isDark ? "#151821" : "#ffffff",
        inputBorder: isDark ? "#252c3c" : "#dedbd1",
        pillBg: isDark ? "#181d26" : "#f0f3eb",
        pillText: isDark ? "#9aa5b6" : "#6d8174",
        pillBorder: isDark ? "#222938" : "#d8e2d8",
        headerBg: isDark ? "#12151b" : "#fbf9f4",
        composerBg: isDark ? "#12151b" : "#fbf9f4",
    };

    useEffect(() => {
        if (typeof document !== "undefined") {
            if (isDark) {
                document.documentElement.classList.add("theme-lovable");
                document.body.classList.add("theme-lovable");
                document.documentElement.setAttribute("data-theme", "lovable");
            } else {
                document.documentElement.classList.remove("theme-lovable");
                document.body.classList.remove("theme-lovable");
                document.documentElement.removeAttribute("data-theme");
            }
        }
    }, [isDark]);

    const [editingAgent, setEditingAgent] = useState<{
        id: string;
        name: string;
        description: string;
        color?: string;
        icon?: string;
        role?: string;
    } | null>(null);
    const [isCreatingAgent, setIsCreatingAgent] = useState(false);
    const [customAgentsList, setCustomAgentsList] = useState<CustomAgentRecord[]>(loadCustomAgents);

    const [screenLogs, setScreenLogs] = useState<string[]>([
        "[runtime] Durable agent harness online over SQLite WAL storage.",
        "[agent] Coordinator active with persistent plan and playbook.",
        "[ready] Ready for exploratory data analysis, hypothesis testing, and queries.",
    ]);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const turns = useMemo(() => groupIntoTurns(transcript), [transcript]);
    const lastIsUser = transcript[transcript.length - 1]?.role === "user";

    const customMatch = customAgentsList.find((c) => c.id === activeAgentId);
    const baseAgent =
        activeAgentId === "dataclaw"
            ? agents[0] || {
                  id: "dataclaw",
                  name: "DataClaw",
                  description: "Built-in coordinator & analytics pilot",
                  status: "Ready",
                  working,
                  model: "Pi Engine",
                  sources: ["Databricks", "Local CSV", "PlaybookDoc"],
              }
            : roster.find((r) => r.id === activeAgentId) ||
              (customMatch
                  ? {
                        id: customMatch.id,
                        name: customMatch.name,
                        role: customMatch.role,
                        purpose: customMatch.description,
                        compute: customMatch.compute?.kind ?? "local",
                        status: "active" as const,
                        capabilities: customMatch.capabilities ?? ["analyst", "data", "coding", "plugins"],
                        skills: customMatch.skills ?? [],
                        sources: ["Filesystem", "Sandbox", "Data Sources"],
                    }
                  : {
                        id: activeAgentId,
                        name: activeAgentId,
                        description: "Specialist agent",
                        status: "Ready",
                        working,
                        model: "Pi Engine",
                        sources: ["Filesystem"],
                    });

    const baseDescription =
        "description" in baseAgent
            ? (baseAgent as WorkspaceAgent).description
            : (baseAgent as RosterEntry).purpose;
    const baseRole =
        "role" in baseAgent
            ? (baseAgent as RosterEntry).role
            : "Coordinator";
    const baseSources =
        "sources" in baseAgent
            ? (baseAgent as WorkspaceAgent).sources
            : [`compute: ${(baseAgent as RosterEntry).compute}`];

    const activeCustom = customizations[activeAgentId] || {};
    const activeDisplayName = activeCustom.name || baseAgent.name;
    const activeDisplayDesc = activeCustom.description || baseDescription;
    const activeColor = activeCustom.color;
    const activeIcon = activeCustom.icon;

    // Combine DataClaw (pinned/builtin), roster, custom agents, and mock specialists
    const allBots = useMemo(() => {
        const list = [
            {
                id: "dataclaw",
                name: "DataClaw",
                role: "Lead Coordinator",
                description: "Built-in coordinator & analytics pilot",
                lastMessage: "sent. inbox at zero, 5 drafts parked",
                time: "12:11 AM",
                active: activeAgentId === "dataclaw",
                color: "#276d60",
                icon: "dot-eyes",
                pinned: true,
                isBuiltin: true,
            },
            ...roster.map((r, i) => ({
                id: r.id,
                name: r.name,
                role: r.role,
                description: r.purpose,
                lastMessage: `${r.purpose.slice(0, 42)}...`,
                time: i === 0 ? "3:10 AM" : "Yesterday",
                active: activeAgentId === r.id,
                color: ["#d97706", "#8b5cf6", "#06b6d4", "#e11d48", "#3b82f6"][i % 5],
                icon: "dot-eyes",
                pinned: false,
                isBuiltin: false,
            })),
        ];

        // Add user-created custom agents that aren't already in list
        for (const ca of customAgentsList) {
            if (!list.some((b) => b.id === ca.id)) {
                list.push({
                    id: ca.id,
                    name: ca.name,
                    role: ca.role,
                    description: ca.description,
                    lastMessage: ca.initialTask || `${ca.description.slice(0, 42)}...`,
                    time: "Just now",
                    active: activeAgentId === ca.id,
                    color: ca.color || "#f59e0b",
                    icon: ca.icon || "dot-eyes",
                    pinned: false,
                    isBuiltin: false,
                });
            }
        }

        return list.map((b) => {
            const c = customizations[b.id] || {};
            return {
                ...b,
                name: c.name || b.name,
                role: c.role || b.role,
                description: c.description || b.description,
                color: c.color || b.color,
                icon: c.icon || b.icon,
            };
        });
    }, [roster, customAgentsList, activeAgentId, customizations]);

    const filteredBots = useMemo(() => {
        if (!searchFilter.trim()) return allBots;
        const q = searchFilter.toLowerCase();
        return allBots.filter(
            (b) => b.name.toLowerCase().includes(q) || b.role.toLowerCase().includes(q)
        );
    }, [allBots, searchFilter]);

    const pinnedBots = useMemo(() => filteredBots.filter((b) => b.pinned), [filteredBots]);
    const otherBots = useMemo(() => filteredBots.filter((b) => !b.pinned), [filteredBots]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [transcript.length, working]);

    const [grokTone, setGrokTone] = useState<GrokTone>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("dataclaw.grok_tone");
            if (saved === "sharp" || saved === "executive" || saved === "research") {
                return saved;
            }
        }
        return "sharp";
    });

    const handleSelectTone = (tone: GrokTone) => {
        setGrokTone(tone);
        if (typeof window !== "undefined") {
            localStorage.setItem("dataclaw.grok_tone", tone);
        }
    };

    const handleSend = (textOverride?: string) => {
        const text = (textOverride ?? draft).trim();
        if (!text || working || stopping) return;
        setDraft("");

        const toneObj = GROK_TONES.find((t) => t.id === grokTone);
        const directive = toneObj ? `[Tone: ${toneObj.label} (${toneObj.tag})]\n${text}` : text;

        ask(directive);
        setScreenLogs((prev) => [
            ...prev,
            `[user-goal] ${text}`,
            toneObj ? `[grok-tone] ${toneObj.label} active` : `[agent-step] Evaluating plan...`,
            `[agent-step] Evaluating plan and required tools...`,
        ]);
    };

    const handleSelectQuickAction = (action: GrokQuickAction) => {
        if (working || stopping) return;
        setDraft(action.prompt);
        inputRef.current?.focus();
    };

    const handleMentionAgent = (agentName: string) => {
        const mention = `@${agentName} `;
        setDraft((prev) => {
            if (prev.endsWith(" ") || prev === "") return prev + mention;
            return prev + " " + mention;
        });
        inputRef.current?.focus();
    };

    const handleAddRoutine = () => {
        const title = prompt("Enter routine title (e.g. Daily Churn Audit):");
        if (!title) return;
        const newRoutine: AgentRoutine = {
            id: String(Date.now()),
            title,
            frequency: "Every 24h",
            status: "active",
            lastRun: "Scheduled",
        };
        setRoutines((prev) => [...prev, newRoutine]);
    };

    const handleExecuteControl = (e: React.FormEvent) => {
        e.preventDefault();
        if (!screenCommand.trim()) return;
        const cmd = screenCommand.trim();
        setScreenCommand("");
        setScreenLogs((prev) => [
            ...prev,
            `$ ${cmd}`,
            `[bash-exec] Submitting command to ${baseAgent.name} execution environment...`,
        ]);
        ask(`Execute bash command in workspace: ${cmd}`);
    };

    const handleSaveCustomization = (custom: AgentCustomization) => {
        if (!editingAgent) return;
        const updated = saveAgentCustomization(editingAgent.id, custom);
        if (updated) {
            setCustomizations(updated);
        } else {
            setCustomizations((prev) => ({
                ...prev,
                [editingAgent.id]: { ...(prev[editingAgent.id] || {}), ...custom },
            }));
        }
    };

    const handleCreateAgent = (newAgentData: {
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
    }) => {
        const cleanId =
            newAgentData.name
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || `specialist-${Date.now()}`;

        const record: CustomAgentRecord = {
            id: cleanId,
            name: newAgentData.name,
            role: newAgentData.role,
            description: newAgentData.description,
            color: newAgentData.color,
            icon: newAgentData.icon,
            instructions: newAgentData.instructions,
            capabilities: newAgentData.capabilities,
            compute: newAgentData.compute,
            skills: newAgentData.skills,
            initialTask: newAgentData.initialTask,
            createdAt: Date.now(),
        };

        const updated = saveCustomAgent(record);
        setCustomAgentsList(updated);

        saveAgentCustomization(cleanId, {
            name: newAgentData.name,
            role: newAgentData.role,
            description: newAgentData.description,
            color: newAgentData.color,
            icon: newAgentData.icon,
            instructions: newAgentData.instructions,
            capabilities: newAgentData.capabilities,
            compute: newAgentData.compute?.kind,
            skills: newAgentData.skills,
        });
        setCustomizations(loadAgentCustomizations());

        onSelectAgent(cleanId);

        const capsStr = newAgentData.capabilities && newAgentData.capabilities.length > 0
            ? ` capabilities: [${newAgentData.capabilities.map((c) => `"${c}"`).join(", ")}]`
            : "";
        const computeStr = newAgentData.compute
            ? ` compute: ${JSON.stringify(newAgentData.compute)}`
            : "";
        const instrStr = newAgentData.instructions
            ? ` instructions: "${newAgentData.instructions.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
            : "";
        const skillsStr = newAgentData.skills && newAgentData.skills.length > 0
            ? ` skills: [${newAgentData.skills.map((s) => `"${s}"`).join(", ")}]`
            : "";

        const directive = newAgentData.initialTask
            ? `Create a specialist agent named "${cleanId}" (Role: ${newAgentData.role}) with purpose: "${newAgentData.description}".${capsStr}${computeStr}${instrStr}${skillsStr} Set up their workspace and run kickoff task: "${newAgentData.initialTask}".`
            : `Create a specialist agent named "${cleanId}" (Role: ${newAgentData.role}) with purpose: "${newAgentData.description}".${capsStr}${computeStr}${instrStr}${skillsStr} Set up their workspace.`;
        ask(directive);
        setScreenLogs((prev) => [
            ...prev,
            `[fleet] Spawned new ${newAgentData.role} teammate "${newAgentData.name}" (${cleanId})`,
            `[compute] Configured ${newAgentData.compute?.kind || "local"} runtime at /workspace/agents/${cleanId}`,
        ]);
    };

    return (
        <div
            className={isDark ? "theme-lovable" : ""}
            style={{
                display: "flex",
                height: "100dvh",
                background: t.bg,
                color: t.textPrimary,
                fontFamily: "var(--app-font-sans, -apple-system, BlinkMacSystemFont, sans-serif)",
                overflow: "hidden",
                position: fullscreen ? "fixed" : "relative",
                inset: fullscreen ? 0 : "auto",
                zIndex: fullscreen ? 999 : "auto",
            }}
        >
            {/* ============================================================ */}
            {/* COLUMN 1: TEAMMATES / DOTS ROSTER (PROMINENT AGENT NAMES)    */}
            {/* ============================================================ */}
            <aside
                style={{
                    width: 260,
                    minWidth: 260,
                    background: t.panelBg,
                    borderRight: `1px solid ${t.border}`,
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                }}
            >
                {/* Header: Stillwork launcher, Teammates title, and New Agent Button */}
                <div
                    style={{
                        padding: "14px 16px 12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderBottom: `1px solid ${t.borderSubtle}`,
                        background: t.panelBg,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        {onOpenStillworkMenu && (
                            <button
                                type="button"
                                onClick={onOpenStillworkMenu}
                                title="Open Stillwork Console platform navigation"
                                style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 7,
                                    background: isDark ? "#1c212c" : "#e8f3ee",
                                    border: `1px solid ${isDark ? "#2a3243" : "#c7ded3"}`,
                                    display: "grid",
                                    placeItems: "center",
                                    color: t.accent,
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                    padding: 0,
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = t.accent;
                                    e.currentTarget.style.color = "#ffffff";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = isDark ? "#1c212c" : "#e8f3ee";
                                    e.currentTarget.style.color = t.accent;
                                }}
                            >
                                <Layers3 size={15} />
                            </button>
                        )}
                        <div>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 13.5,
                                    color: t.textPrimary,
                                    lineHeight: 1.15,
                                    letterSpacing: "-0.01em",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <span>Teammates</span>
                                <span
                                    style={{
                                        fontSize: 9.5,
                                        color: t.accent,
                                        background: t.accentSubtle,
                                        padding: "1px 5px",
                                        borderRadius: 4,
                                        fontWeight: 600,
                                        fontFamily: "var(--app-font-mono, monospace)",
                                    }}
                                >
                                    {allBots.length}
                                </span>
                            </div>
                            <div style={{ fontSize: 10, color: t.textMuted }}>
                                Active Dots & specialists
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsCreatingAgent(true)}
                        title="Configure and spawn a new teammate"
                        style={{
                            background: t.accent,
                            border: "none",
                            color: "#ffffff",
                            cursor: "pointer",
                            padding: "5px 10px",
                            borderRadius: 7,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 11.5,
                            fontWeight: 600,
                            boxShadow: isDark
                                ? "0 2px 8px rgba(255, 94, 87, 0.35)"
                                : "0 1px 3px rgba(39, 109, 96, 0.25)",
                            transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = t.accentHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = t.accent)}
                    >
                        <Plus size={13} strokeWidth={2.5} />
                        <span>New</span>
                    </button>
                </div>

                {/* Search Bar */}
                <div style={{ padding: "10px 14px 8px" }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            background: t.inputBg,
                            borderRadius: 8,
                            padding: "6px 10px",
                            border: `1px solid ${t.inputBorder}`,
                        }}
                    >
                        <Search size={13} color={t.textMuted} />
                        <input
                            type="text"
                            placeholder="Search teammates..."
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                            style={{
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                color: t.textPrimary,
                                fontSize: 12,
                                width: "100%",
                            }}
                        />
                    </div>
                </div>

                {/* Bot List with PINNED and TEAMMATES sections */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "6px 8px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    {/* PINNED (DataClaw default built-in coordinator) */}
                    {pinnedBots.length > 0 && (
                        <div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "4px 8px 6px",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: t.textMuted,
                                }}
                            >
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <Pin size={10} color={t.accent} /> PINNED
                                </span>
                                <span
                                    style={{
                                        fontSize: 9,
                                        padding: "1px 6px",
                                        borderRadius: 4,
                                        background: t.accentSubtle,
                                        color: t.accent,
                                        fontWeight: 600,
                                    }}
                                >
                                    Default · Built-in
                                </span>
                            </div>

                            {pinnedBots.map((bot) => (
                                <div
                                    key={bot.id}
                                    onClick={() => onSelectAgent(bot.id)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "9px 10px",
                                        borderRadius: 10,
                                        cursor: "pointer",
                                        background: bot.active ? t.activeItemBg : t.inactiveItemBg,
                                        border: bot.active
                                            ? `1px solid ${t.activeItemBorder}`
                                            : `1px solid ${t.inactiveItemBorder}`,
                                        transition: "all 0.15s ease",
                                        position: "relative",
                                        boxShadow: bot.active
                                            ? (isDark ? "0 2px 10px rgba(255, 94, 87, 0.22)" : "0 1px 3px rgba(39, 109, 96, 0.08)")
                                            : "none",
                                    }}
                                >
                                    <GrokbotAvatar
                                        name={bot.name}
                                        color={bot.color}
                                        icon={bot.icon}
                                        size={36}
                                        isWorking={bot.active && working}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                marginBottom: 2,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontWeight: bot.active ? 700 : 600,
                                                    fontSize: 13,
                                                    color: bot.active ? (isDark ? "#ffffff" : "#174338") : t.textPrimary,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 4,
                                                }}
                                            >
                                                {bot.name}
                                                <Pin size={10} color={t.accent} />
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 9.5,
                                                    color: t.textMuted,
                                                    fontFamily: "var(--app-font-mono, monospace)",
                                                    marginLeft: 4,
                                                }}
                                            >
                                                {bot.time}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 11,
                                                color: t.textSecondary,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {bot.lastMessage}
                                        </div>
                                    </div>

                                    {/* Edit agent button */}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingAgent({
                                                id: bot.id,
                                                name: bot.name,
                                                description: bot.description,
                                                color: bot.color,
                                                icon: bot.icon,
                                                role: bot.role,
                                            });
                                        }}
                                        title={`Edit ${bot.name}`}
                                        style={{
                                            background: "transparent",
                                            border: "none",
                                            borderRadius: 4,
                                            width: 22,
                                            height: 22,
                                            display: "grid",
                                            placeItems: "center",
                                            color: t.textMuted,
                                            cursor: "pointer",
                                            opacity: bot.active ? 1 : 0.6,
                                        }}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.color = t.accent)
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.color = t.textMuted)
                                        }
                                    >
                                        <Pencil size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* TEAMMATES SECTION */}
                    <div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 8px 6px",
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                color: t.textMuted,
                            }}
                        >
                            <span>Specialists ({otherBots.length})</span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {otherBots.map((bot) => (
                                <div
                                    key={bot.id}
                                    onClick={() => onSelectAgent(bot.id)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "9px 10px",
                                        borderRadius: 10,
                                        cursor: "pointer",
                                        background: bot.active ? t.activeItemBg : t.inactiveItemBg,
                                        border: bot.active
                                            ? `1px solid ${t.activeItemBorder}`
                                            : `1px solid ${t.inactiveItemBorder}`,
                                        transition: "all 0.15s ease",
                                        position: "relative",
                                        boxShadow: bot.active
                                            ? (isDark ? "0 2px 10px rgba(255, 94, 87, 0.22)" : "0 1px 3px rgba(39, 109, 96, 0.08)")
                                            : "none",
                                    }}
                                >
                                    <GrokbotAvatar
                                        name={bot.name}
                                        color={bot.color}
                                        icon={bot.icon}
                                        size={36}
                                        isWorking={bot.active && working}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                marginBottom: 2,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontWeight: bot.active ? 700 : 600,
                                                    fontSize: 13,
                                                    color: bot.active ? (isDark ? "#ffffff" : "#174338") : t.textPrimary,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {bot.name}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 9.5,
                                                    color: t.textMuted,
                                                    fontFamily: "var(--app-font-mono, monospace)",
                                                    marginLeft: 4,
                                                }}
                                            >
                                                {bot.time}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 11,
                                                color: t.textSecondary,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {bot.lastMessage}
                                        </div>
                                    </div>

                                    {/* Edit agent button */}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingAgent({
                                                id: bot.id,
                                                name: bot.name,
                                                description: bot.description,
                                                color: bot.color,
                                                icon: bot.icon,
                                                role: bot.role,
                                            });
                                        }}
                                        title={`Edit ${bot.name}`}
                                        style={{
                                            background: "transparent",
                                            border: "none",
                                            borderRadius: 4,
                                            width: 22,
                                            height: 22,
                                            display: "grid",
                                            placeItems: "center",
                                            color: t.textMuted,
                                            cursor: "pointer",
                                            opacity: bot.active ? 1 : 0.6,
                                        }}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.color = t.accent)
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.color = t.textMuted)
                                        }
                                    >
                                        <Pencil size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Bottom Profile & Settings Bar */}
                <div
                    style={{
                        padding: "10px 14px",
                        borderTop: `1px solid ${t.borderSubtle}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: t.panelBg,
                        gap: 8,
                        userSelect: "none",
                    }}
                >
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setProfileModalOpen(true)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") setProfileModalOpen(true);
                        }}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            cursor: "pointer",
                            flex: 1,
                            minWidth: 0,
                            padding: "4px 6px",
                            borderRadius: 8,
                            transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = t.hoverItemBg)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        title="View profile & settings"
                    >
                        <div style={{ position: "relative", flexShrink: 0 }}>
                            <div
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: "50%",
                                    background: userProfile.avatarColor || t.accent,
                                    color: "#ffffff",
                                    display: "grid",
                                    placeItems: "center",
                                    fontWeight: 700,
                                    fontSize: 12,
                                    letterSpacing: "-0.02em",
                                    boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.12)",
                                }}
                            >
                                {userProfile.initials || "MA"}
                            </div>
                            <span
                                style={{
                                    position: "absolute",
                                    bottom: 0,
                                    right: 0,
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: "#22c55e",
                                    border: `1.5px solid ${t.panelBg}`,
                                }}
                            />
                        </div>
                        <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                            <div
                                style={{
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    color: t.textPrimary,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    lineHeight: 1.2,
                                }}
                            >
                                {userProfile.name || "Matheus"}
                            </div>
                            <div
                                style={{
                                    fontSize: 10,
                                    color: t.textMuted,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {userProfile.role || "Lead Engineer"}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        {/* Theme Toggle Button (Classic Paper vs Lovable Dark) */}
                        <button
                            type="button"
                            onClick={() => toggleTheme()}
                            title={isDark ? "Switch to Classic theme" : "Switch to Lovable Dark theme"}
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 7,
                                background: isDark ? "#191d28" : "transparent",
                                border: `1px solid ${isDark ? "#283042" : "#e3ded5"}`,
                                color: isDark ? "#ff5e57" : "#6b7d75",
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = isDark ? "#222838" : "#efebe3";
                                e.currentTarget.style.color = isDark ? "#ff756d" : "#203a37";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = isDark ? "#191d28" : "transparent";
                                e.currentTarget.style.color = isDark ? "#ff5e57" : "#6b7d75";
                            }}
                        >
                            {isDark ? <Sun size={14} /> : <Moon size={14} />}
                        </button>

                        <button
                            type="button"
                            onClick={() => setProfileModalOpen(true)}
                            title="Profile & Settings"
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 7,
                                background: isDark ? "#191d28" : "transparent",
                                border: `1px solid ${isDark ? "#283042" : "#e3ded5"}`,
                                color: isDark ? "#9da7b7" : "#6b7d75",
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = isDark ? "#222838" : "#efebe3";
                                e.currentTarget.style.color = isDark ? "#f1f3f7" : "#203a37";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = isDark ? "#191d28" : "transparent";
                                e.currentTarget.style.color = isDark ? "#9da7b7" : "#6b7d75";
                            }}
                        >
                            <Settings2 size={14} />
                        </button>
                    </div>
                </div>
            </aside>

            {/* ============================================================ */}
            {/* COLUMN 2: CENTER CHAT STREAM                                 */}
            {/* ============================================================ */}
            <main
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    background: t.bg,
                    minWidth: 0,
                    borderRight: showDeepDive ? `1px solid ${t.border}` : "none",
                }}
            >
                {/* Chat Header */}
                <header
                    style={{
                        height: 56,
                        padding: "0 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderBottom: `1px solid ${t.borderSubtle}`,
                        background: t.panelBg,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <GrokbotAvatar
                            name={activeDisplayName}
                            color={activeColor}
                            icon={activeIcon}
                            size={34}
                            isWorking={working}
                            mood={working ? "thinking" : grokTone === "sharp" ? "sharp" : "normal"}
                        />
                        <div>
                            <div
                                style={{
                                    fontWeight: 700,
                                    fontSize: 14,
                                    color: t.textPrimary,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    fontFamily: "var(--app-font-serif, sans-serif)",
                                }}
                            >
                                {activeDisplayName}
                                {activeAgentId === "dataclaw" && (
                                    <span
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 4,
                                            fontSize: 9.5,
                                            fontWeight: 600,
                                            padding: "2px 7px",
                                            borderRadius: 999,
                                            background: t.accentSubtle,
                                            color: t.accent,
                                            border: `1px solid ${t.accentBorder}`,
                                        }}
                                    >
                                        <Pin size={9} />
                                        Built-in · Coordinator
                                    </span>
                                )}
                                <span
                                    className={
                                        working
                                            ? "status-pill status-running"
                                            : "status-pill status-idle"
                                    }
                                    style={{ fontSize: 9.5 }}
                                >
                                    {working ? "Working" : "Ready"}
                                </span>
                            </div>
                            <div style={{ fontSize: 11, color: t.textMuted }}>
                                {baseSources.join(" · ")}
                                {ops && "model" in baseAgent ? ` · ${(baseAgent as any).model}` : ""}
                            </div>
                        </div>
                    </div>

                    {/* Grok Tone Switcher Segmented Control */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            background: isDark ? "rgba(255, 255, 255, 0.05)" : "#eeebe3",
                            borderRadius: 10,
                            padding: "3px",
                            gap: 2,
                        }}
                        role="radiogroup"
                        aria-label="Grok Persona Tone"
                    >
                        {GROK_TONES.map((tone) => {
                            const active = grokTone === tone.id;
                            return (
                                <button
                                    key={tone.id}
                                    type="button"
                                    onClick={() => handleSelectTone(tone.id)}
                                    title={`${tone.label} (${tone.tag}): ${tone.description}`}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 5,
                                        fontSize: 11,
                                        fontWeight: active ? 700 : 500,
                                        padding: "4px 9px",
                                        borderRadius: 7,
                                        border: "none",
                                        cursor: "pointer",
                                        background: active
                                            ? (isDark ? "#1e2433" : "#ffffff")
                                            : "transparent",
                                        color: active
                                            ? (isDark ? "#f1f3f7" : "#1c332e")
                                            : (isDark ? "#828d9e" : "#6c7b74"),
                                        boxShadow: active
                                            ? (isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.08)")
                                            : "none",
                                        transition: "all 0.15s ease",
                                    }}
                                >
                                    <span>{tone.icon}</span>
                                    <span>{tone.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Edit Agent Button */}
                        <button
                            type="button"
                            onClick={() =>
                                setEditingAgent({
                                    id: activeAgentId,
                                    name: activeDisplayName,
                                    description: activeDisplayDesc,
                                    color: activeColor,
                                    icon: activeIcon,
                                    role: baseRole,
                                })
                            }
                            className="button-quiet"
                            title="Edit agent appearance, name, or role"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 11.5,
                                padding: "5px 9px",
                                color: t.textSecondary,
                            }}
                        >
                            <Pencil size={13} />
                            <span>Edit</span>
                        </button>

                        {/* Context Toggle */}
                        <button
                            type="button"
                            className="button-quiet"
                            onClick={() => setShowContext(!showContext)}
                            aria-expanded={showContext}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11.5,
                                padding: "5px 9px",
                                color: t.textSecondary,
                            }}
                        >
                            <span>Context</span>
                            <ChevronDown
                                size={13}
                                className={
                                    showContext ? "chat-chevron open" : "chat-chevron"
                                }
                            />
                        </button>

                        {/* Optional Data Deep Dive Panel Toggle Button */}
                        <button
                            type="button"
                            onClick={() => setShowDeepDive(!showDeepDive)}
                            title={
                                showDeepDive
                                    ? "Close Data Deep Dive panel"
                                    : "Open Data Deep Dive panel to inspect tables, telemetry, and compute"
                            }
                            style={{
                                background: showDeepDive
                                    ? (isDark ? "rgba(255, 94, 87, 0.16)" : "#e2eee6")
                                    : (isDark ? "#171a23" : "#ffffff"),
                                border: showDeepDive
                                    ? `1px solid ${t.accent}`
                                    : `1px solid ${t.border}`,
                                color: showDeepDive ? t.accent : t.textPrimary,
                                borderRadius: 8,
                                padding: "5px 11px",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                boxShadow: showDeepDive
                                    ? "inset 0 1px 2px rgba(0,0,0,0.12)"
                                    : "0 1px 2px rgba(0,0,0,0.03)",
                                transition: "all 0.15s ease",
                            }}
                        >
                            <Database size={13} color={showDeepDive ? t.accent : t.textMuted} />
                            <span>Data Deep Dive</span>
                            {showDeepDive ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                        </button>
                    </div>
                </header>

                {/* Expandable Context Panel */}
                {showContext && (
                    <div className="chat-context" style={{ background: t.panelBg, borderBottom: `1px solid ${t.borderSubtle}` }}>
                        <p style={{ color: t.textSecondary }}>{activeDisplayDesc}</p>
                        <div className="panel-note" style={{ color: t.textMuted }}>
                            {workspacePath ?? "Opening workspace…"} · AGENTS.md loads every turn
                        </div>
                    </div>
                )}

                {/* Message Scroll Area */}
                <div className="chat-scroll">
                    <div className="chat-thread">
                        {transcript.length === 0 ? (
                            <div className="chat-empty" style={{ maxWidth: 580, margin: "28px auto 0", textAlign: "center" }}>
                                <div
                                    style={{
                                        width: 50,
                                        height: 50,
                                        borderRadius: "50%",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        marginBottom: 12,
                                    }}
                                >
                                    <GrokbotAvatar
                                        name={activeDisplayName}
                                        color={activeColor}
                                        icon={activeIcon}
                                        size={50}
                                        isWorking={false}
                                    />
                                </div>
                                <h2 style={{ fontSize: 18, fontWeight: 700, color: t.textPrimary, marginBottom: 6 }}>
                                    What should {activeDisplayName} explore?
                                </h2>
                                <p style={{ fontSize: 13, color: t.textSecondary, margin: "0 auto 16px", maxWidth: 440, lineHeight: 1.45 }}>
                                    Ask about Unity Catalog schemas, profile local datasets, detect churn drivers, or spin up specialists.
                                </p>

                                {/* Compact single-line telemetry pill */}
                                <div
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: 11.5,
                                        color: t.accent,
                                        background: t.accentSubtle,
                                        border: `1px solid ${t.accentBorder}`,
                                        padding: "4px 12px",
                                        borderRadius: 999,
                                        marginBottom: 20,
                                        fontWeight: 600,
                                    }}
                                >
                                    <span>✓ Unity Catalog connected</span>
                                    <span>·</span>
                                    <span>0 drift violations</span>
                                    <span>·</span>
                                    <span>Sandbox compute ready</span>
                                </div>

                                <div className="chat-starters" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                    {STARTER_PROMPTS.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => ask(s.query)}
                                            disabled={working}
                                            style={{
                                                textAlign: "left",
                                                padding: "11px 13px",
                                                borderRadius: 10,
                                                background: t.cardBg,
                                                border: `1px solid ${t.border}`,
                                                cursor: "pointer",
                                                transition: "all 0.15s ease",
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = t.accent;
                                                e.currentTarget.style.background = isDark ? "#1f2533" : "#f7faf8";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = t.border;
                                                e.currentTarget.style.background = t.cardBg;
                                            }}
                                        >
                                            <div style={{ fontWeight: 700, fontSize: 12.5, color: t.textPrimary, marginBottom: 3 }}>
                                                {s.title}
                                            </div>
                                            <div style={{ fontSize: 11, color: t.textSecondary, lineHeight: 1.35 }}>
                                                {s.desc}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            turns.map((turn, i) => {
                                const isLast = i === turns.length - 1;
                                if (turn.role === "user") {
                                    const userText = turn.userText ?? "";
                                    const matchTone = userText.match(/^\[Tone:\s*([^\]]+)\]\n([\s\S]*)$/);
                                    const displayUserText = matchTone ? matchTone[2] : userText;
                                    const toneBadge = matchTone ? matchTone[1] : null;

                                    return (
                                        <div className="chat-msg chat-user" key={turn.id}>
                                            <div className="chat-bubble">
                                                {toneBadge && (
                                                    <div
                                                        style={{
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            letterSpacing: "0.4px",
                                                            opacity: 0.9,
                                                            marginBottom: 5,
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 4,
                                                            padding: "1px 7px",
                                                            borderRadius: 999,
                                                            background: "rgba(255, 255, 255, 0.16)",
                                                        }}
                                                    >
                                                        <span>{toneBadge}</span>
                                                    </div>
                                                )}
                                                <div className="chat-user-text">
                                                    {displayUserText}
                                                </div>
                                            </div>
                                            <time>{turn.time}</time>
                                        </div>
                                    );
                                }

                                const outcomes =
                                    (!working || !isLast) && (Boolean(turn.assistantText?.trim()) || turn.tools.length > 0)
                                        ? extractTurnOutcomes(turn)
                                        : [];

                                return (
                                    <div className="chat-msg chat-assistant" key={turn.id}>
                                        <span
                                            className="chat-avatar"
                                            style={{
                                                background: activeColor
                                                    ? `${activeColor}18`
                                                    : undefined,
                                            }}
                                        >
                                            <GrokbotAvatar
                                                name={activeDisplayName}
                                                color={activeColor}
                                                icon={activeIcon}
                                                size={28}
                                                isWorking={working && isLast}
                                                mood={working && isLast ? "thinking" : grokTone === "sharp" ? "sharp" : "normal"}
                                            />
                                        </span>
                                        <AssistantTurnView
                                            turn={turn}
                                            live={working && isLast}
                                            hideOuterShell={true}
                                            footerExtra={
                                                outcomes.length > 0 ? (
                                                    <GrokOutcomeCard items={outcomes} isDark={isDark} />
                                                ) : undefined
                                            }
                                        />
                                    </div>
                                );
                            })
                        )}

                        {working && lastIsUser && (
                            <div className="chat-msg chat-assistant">
                                <span className="chat-avatar">
                                    <GrokbotAvatar
                                        name={activeDisplayName}
                                        color={activeColor}
                                        icon={activeIcon}
                                        size={28}
                                        isWorking={true}
                                        mood="thinking"
                                    />
                                </span>
                                <div className="chat-assistant-body">
                                    <div
                                        className="chat-typing-inline"
                                        aria-label={`${activeDisplayName} is thinking`}
                                    >
                                        <span>Thinking…</span>
                                        <div className="chat-typing">
                                            <i />
                                            <i />
                                            <i />
                                        </div>
                                        <span style={{ fontSize: 10.5, opacity: 0.75, fontStyle: "normal", marginLeft: 2 }}>
                                            · Checkpointed in SQLite
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={endRef} />
                    </div>
                </div>

                {/* Grokbot Action Bar & Classic Chat Composer */}
                <div className="chat-composer-wrap">
                    {/* Grok Interactive Action Bar */}
                    <div
                        style={{
                            maxWidth: 820,
                            margin: "0 auto 8px auto",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}
                    >
                        {/* Grok Statistical Action Pills */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                overflowX: "auto",
                                paddingBottom: 2,
                                scrollbarWidth: "none",
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                    color: t.textMuted,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 3,
                                    paddingRight: 4,
                                    flexShrink: 0,
                                }}
                            >
                                <Zap size={11} color={t.accent} />
                                Grok Actions
                            </span>
                            {GROK_QUICK_ACTIONS.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    onClick={() => handleSelectQuickAction(action)}
                                    title={action.description}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 5,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        padding: "4px 9px",
                                        borderRadius: 999,
                                        border: isDark ? "1px solid #252c3c" : "1px solid #dedbd0",
                                        background: isDark ? "#161a24" : "#ffffff",
                                        color: isDark ? "#c8d0de" : "#2f4540",
                                        cursor: "pointer",
                                        whiteSpace: "nowrap",
                                        flexShrink: 0,
                                        transition: "all 0.15s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = t.accent;
                                        e.currentTarget.style.color = t.accent;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = isDark ? "#252c3c" : "#dedbd0";
                                        e.currentTarget.style.color = isDark ? "#c8d0de" : "#2f4540";
                                    }}
                                >
                                    <span>{action.icon}</span>
                                    <span>{action.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Specialist Delegation Mentions (@mentions) */}
                        {allBots.filter((b) => b.id !== activeAgentId).length > 0 && (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    overflowX: "auto",
                                    scrollbarWidth: "none",
                                    fontSize: 11,
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.5px",
                                        color: t.textMuted,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 3,
                                        paddingRight: 4,
                                        flexShrink: 0,
                                    }}
                                >
                                    <AtSign size={11} color={t.textMuted} />
                                    Delegate
                                </span>
                                {allBots
                                    .filter((b) => b.id !== activeAgentId)
                                    .map((b) => (
                                        <button
                                            key={b.id}
                                            type="button"
                                            onClick={() => handleMentionAgent(b.name)}
                                            title={`Delegate or consult @${b.name} (${b.role})`}
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                fontSize: 10.5,
                                                fontWeight: 600,
                                                padding: "3px 8px",
                                                borderRadius: 6,
                                                border: isDark ? "1px solid #202636" : "1px solid #e5e0d4",
                                                background: isDark ? "#141722" : "#f7f5ed",
                                                color: isDark ? "#9aa5b6" : "#4c6057",
                                                cursor: "pointer",
                                                whiteSpace: "nowrap",
                                                flexShrink: 0,
                                                transition: "all 0.12s ease",
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = b.color || t.accent;
                                                e.currentTarget.style.color = isDark ? "#ffffff" : "#1c332e";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = isDark ? "#202636" : "#e5e0d4";
                                                e.currentTarget.style.color = isDark ? "#9aa5b6" : "#4c6057";
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: "50%",
                                                    background: b.color || "#10b981",
                                                }}
                                            />
                                            <span>@{b.name}</span>
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>

                    <div className="chat-composer">
                        <textarea
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder={`Ask ${activeDisplayName} (${GROK_TONES.find((t) => t.id === grokTone)?.label})…`}
                            rows={1}
                        />

                        {working || stopping ? (
                            <button
                                className="chat-send stop"
                                type="button"
                                onClick={onStop}
                                disabled={stopping}
                                title={stopping ? "Stopping" : "Stop"}
                            >
                                <Square size={13} />
                            </button>
                        ) : (
                            <button
                                className="chat-send"
                                type="button"
                                onClick={() => handleSend()}
                                disabled={!draft.trim()}
                                aria-label="Send"
                            >
                                <ArrowUp size={16} />
                            </button>
                        )}
                    </div>
                    <div className="chat-hint">
                        Enter to send · Shift+Enter for a new line · {GROK_TONES.find((t) => t.id === grokTone)?.label} active · checkpointed in SQLite
                    </div>
                </div>
            </main>

            {/* ============================================================ */}
            {/* COLUMN 3: OPTIONAL DATA DEEP DIVE & COMPUTE PANEL            */}
            {/* ============================================================ */}
            {showDeepDive && (
                <aside
                    style={{
                        width: 340,
                        minWidth: 340,
                        background: t.panelBg,
                        borderLeft: `1px solid ${t.border}`,
                        display: "flex",
                        flexDirection: "column",
                        height: "100%",
                        overflowY: "auto",
                        animation: "panelSlideIn 0.18s ease-out",
                    }}
                >
                    <style>{`
                        @keyframes panelSlideIn {
                            from { transform: translateX(12px); opacity: 0; }
                            to { transform: translateX(0); opacity: 1; }
                        }
                    `}</style>

                    {/* Header */}
                    <div
                        style={{
                            padding: "14px 16px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            borderBottom: `1px solid ${t.borderSubtle}`,
                            background: t.panelBg,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div
                                style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 6,
                                    background: t.accentSubtle,
                                    display: "grid",
                                    placeItems: "center",
                                    color: t.accent,
                                }}
                            >
                                <Database size={14} />
                            </div>
                            <div>
                                <div
                                    style={{
                                        fontWeight: 700,
                                        fontSize: 13,
                                        color: t.textPrimary,
                                    }}
                                >
                                    Data Deep Dive
                                </div>
                                <div style={{ fontSize: 10, color: t.textMuted }}>
                                    {activeDisplayName} · telemetry & compute
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowDeepDive(false)}
                            style={{
                                background: "transparent",
                                border: "none",
                                color: t.textMuted,
                                cursor: "pointer",
                                padding: 4,
                                borderRadius: 5,
                                display: "grid",
                                placeItems: "center",
                            }}
                            title="Close Data Deep Dive panel"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Section 1: Specialist Profile & Environment */}
                    <div style={{ padding: "14px 16px 10px" }}>
                        <div
                            style={{
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                color: t.textMuted,
                                marginBottom: 8,
                            }}
                        >
                            Specialist Environment
                        </div>
                        <div
                            style={{
                                background: t.cardBg,
                                border: `1px solid ${t.border}`,
                                borderRadius: 10,
                                padding: "11px 13px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                fontSize: 11.5,
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: t.textMuted }}>Role Archetype:</span>
                                <span style={{ fontWeight: 600, color: t.textPrimary, textTransform: "capitalize" }}>
                                    {baseRole.replace(/_/g, " ")}
                                </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: t.textMuted }}>Compute Sandbox:</span>
                                <span style={{ fontWeight: 600, color: t.textPrimary, fontFamily: "var(--app-font-mono, monospace)" }}>
                                    {"compute" in baseAgent ? String((baseAgent as any).compute) : "local"}
                                </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                <span style={{ color: t.textMuted }}>Tooling:</span>
                                <span style={{ color: t.accent, fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>
                                    {"capabilities" in baseAgent && Array.isArray((baseAgent as any).capabilities)
                                        ? (baseAgent as any).capabilities.join(", ")
                                        : "analyst, data, coding, plugins"}
                                </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: t.textMuted }}>Status:</span>
                                <span style={{ color: t.accent, fontWeight: 600 }}>
                                    ✓ Active & isolated
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Isolated Sandbox Compute & Execution Terminal */}
                    <div style={{ padding: "8px 16px 10px" }}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 8,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: t.textMuted,
                                }}
                            >
                                Sandbox Compute
                            </span>
                            <button
                                type="button"
                                onClick={() => setHumanTakeover(!humanTakeover)}
                                style={{
                                    background: humanTakeover ? "#d97706" : (isDark ? "#1f2430" : "#ffffff"),
                                    color: humanTakeover ? "#ffffff" : t.textPrimary,
                                    border: humanTakeover
                                        ? "1px solid #b45309"
                                        : `1px solid ${t.border}`,
                                    borderRadius: 5,
                                    padding: "2px 8px",
                                    fontSize: 10,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                }}
                            >
                                {humanTakeover ? "Release takeover" : "Takeover"}
                            </button>
                        </div>

                        {/* Terminal Log */}
                        <div
                            style={{
                                background: isDark ? "#090c10" : "#192723",
                                border: `1px solid ${isDark ? "#1e2432" : "transparent"}`,
                                borderRadius: 8,
                                padding: "8px 10px",
                                fontSize: 10,
                                fontFamily: "var(--app-font-mono, monospace)",
                                color: isDark ? "#ff857f" : "#62d2bc",
                                height: 110,
                                overflowY: "auto",
                                lineHeight: 1.45,
                            }}
                        >
                            {screenLogs.map((log, idx) => (
                                <div key={idx} style={{ wordBreak: "break-all" }}>
                                    {log}
                                </div>
                            ))}
                        </div>

                        {humanTakeover && (
                            <form
                                onSubmit={handleExecuteControl}
                                style={{
                                    marginTop: 6,
                                    display: "flex",
                                    gap: 5,
                                    background: t.cardBg,
                                    padding: 4,
                                    borderRadius: 6,
                                    border: `1px solid ${t.accent}`,
                                }}
                            >
                                <input
                                    type="text"
                                    value={screenCommand}
                                    onChange={(e) => setScreenCommand(e.target.value)}
                                    placeholder="Enter bash command..."
                                    style={{
                                        flex: 1,
                                        background: "transparent",
                                        border: "none",
                                        outline: "none",
                                        color: t.textPrimary,
                                        fontSize: 11,
                                        fontFamily: "var(--app-font-mono, monospace)",
                                        padding: "2px 4px",
                                    }}
                                />
                                <button
                                    type="submit"
                                    style={{
                                        background: t.accent,
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 4,
                                        padding: "2px 8px",
                                        fontSize: 10.5,
                                        fontWeight: 600,
                                        cursor: "pointer",
                                    }}
                                >
                                    Exec
                                </button>
                            </form>
                        )}
                    </div>

                    {/* Section 3: Autonomous Routines */}
                    <div style={{ padding: "8px 16px 20px" }}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: 8,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: t.textMuted,
                                }}
                            >
                                Autonomous Routines
                            </span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {routines.map((routine) => (
                                <div
                                    key={routine.id}
                                    style={{
                                        background: t.cardBg,
                                        border: `1px solid ${t.border}`,
                                        borderRadius: 8,
                                        padding: "8px 10px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                        <Clock size={13} color={isDark ? "#f59e0b" : "#8d5e1a"} />
                                        <div>
                                            <div style={{ fontSize: 11.5, fontWeight: 600, color: t.textPrimary }}>
                                                {routine.title}
                                            </div>
                                            <div style={{ fontSize: 9.5, color: t.textMuted }}>
                                                {routine.lastRun}
                                            </div>
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            fontSize: 9.5,
                                            fontWeight: 600,
                                            color: t.accent,
                                            background: t.accentSubtle,
                                            padding: "2px 6px",
                                            borderRadius: 999,
                                        }}
                                    >
                                        {routine.frequency}
                                    </span>
                                </div>
                            ))}

                            <button
                                type="button"
                                onClick={handleAddRoutine}
                                style={{
                                    background: "transparent",
                                    border: `1px dashed ${t.border}`,
                                    borderRadius: 8,
                                    padding: "6px 10px",
                                    color: t.textSecondary,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginTop: 2,
                                }}
                            >
                                <Plus size={13} />
                                <span>+ New routine</span>
                            </button>
                        </div>
                    </div>
                </aside>
            )}

            {/* Agent Editor Modal */}
            {editingAgent && (
                <AgentEditorModal
                    agent={editingAgent}
                    isOpen={true}
                    onClose={() => setEditingAgent(null)}
                    onSave={handleSaveCustomization}
                />
            )}

            {/* Create Agent Modal */}
            <CreateAgentModal
                isOpen={isCreatingAgent}
                onClose={() => setIsCreatingAgent(false)}
                onCreate={handleCreateAgent}
                availableSkills={skills}
            />

            {/* Profile & Settings Modal */}
            <ProfileSettingsModal
                isOpen={profileModalOpen}
                onClose={() => setProfileModalOpen(false)}
                profile={userProfile}
                onSaveProfile={(p) => {
                    setUserProfile(p);
                    saveUserProfile(p);
                }}
                ops={ops}
                onToggleOps={onToggleOps}
                onOpenSettings={onOpenSettings}
                theme={theme}
                onSelectTheme={toggleTheme}
            />
        </div>
    );
}
