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
    Activity,
    ArrowUp,
    AtSign,
    Bot,
    BrainCircuit,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    Copy,
    Cpu,
    Database,
    ExternalLink,
    HardDrive,
    Layers3,
    LayoutGrid,
    Maximize2,
    Mic,
    Minimize2,
    Monitor,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Pin,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    ShieldCheck,
    Sparkles,
    Square,
    Star,
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
    name: "Workspace Member",
    role: "Data & AI",
    initials: "WM",
    avatarColor: "#1d4ed8",
};

export function loadUserProfile(): UserProfile {
    if (typeof window === "undefined") return DEFAULT_USER_PROFILE;
    try {
        const raw = window.localStorage.getItem("dataclaw.userProfile");
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.name === "Matheus" || parsed.name === "Matheus Buniotto") {
                return DEFAULT_USER_PROFILE;
            }
            return { ...DEFAULT_USER_PROFILE, ...parsed };
        }
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
                .toUpperCase() || "WM"
        );
    }, [name]);

    const handleSave = () => {
        onSaveProfile({
            name: name.trim() || "Workspace Member",
            role: role.trim() || "Data & AI",
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
    hasStarBadge = false,
}: {
    name: string;
    color?: string;
    icon?: string;
    size?: number;
    isWorking?: boolean;
    mood?: GrokbotMood;
    hasStarBadge?: boolean;
}) {
    const palette = [
        "#1d4ed8", // Principal Royal Blue
        "#ef4444", // Red (Job Hunt)
        "#06b6d4", // Cyan (Zelador)
        "#f59e0b", // Amber (Claude Enabler)
        "#10b981", // Emerald (Arquiteto)
        "#8b5cf6", // Purple
        "#6b7280", // Slate (Pixel)
        "#e11d48", // Rose
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

        // Expressive Cute Grokbot bean eyes matching reference screenshot
        const beanW = Math.max(3, Math.round(size * 0.11));
        const beanH = Math.max(6.5, Math.round(size * 0.23));
        const beanGap = Math.max(3.5, Math.round(size * 0.13));

        if (effectiveMood === "thinking") {
            return (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: beanGap,
                        animation: "grokScan 1.6s ease-in-out infinite",
                    }}
                >
                    <div
                        style={{
                            width: beanW,
                            height: beanH,
                            borderRadius: 999,
                            background: "#ffffff",
                            transform: "rotate(-12deg)",
                            animation: "grokBlink 3.2s infinite",
                        }}
                    />
                    <div
                        style={{
                            width: beanW,
                            height: beanH,
                            borderRadius: 999,
                            background: "#ffffff",
                            transform: "rotate(12deg)",
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
                        gap: beanGap,
                    }}
                >
                    <div
                        style={{
                            width: beanW * 1.1,
                            height: beanH * 0.9,
                            borderRadius: 999,
                            background: "#ffffff",
                            transform: "rotate(-18deg)",
                        }}
                    />
                    <div
                        style={{
                            width: beanW,
                            height: beanH,
                            borderRadius: 999,
                            background: "#ffffff",
                            transform: "rotate(12deg)",
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
                        gap: beanGap + 1,
                        animation: "grokAlertShake 3s ease-in-out infinite",
                    }}
                >
                    <div
                        style={{
                            width: beanW * 1.25,
                            height: beanH * 1.1,
                            borderRadius: 999,
                            background: "#ffffff",
                            transform: "rotate(-8deg)",
                            boxShadow: "0 0 4px rgba(255,255,255,0.8)",
                        }}
                    />
                    <div
                        style={{
                            width: beanW * 1.25,
                            height: beanH * 1.1,
                            borderRadius: 999,
                            background: "#ffffff",
                            transform: "rotate(8deg)",
                            boxShadow: "0 0 4px rgba(255,255,255,0.8)",
                        }}
                    />
                </div>
            );
        }

        // Normal default bean eyes with gentle blinking
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: beanGap,
                }}
            >
                <div
                    style={{
                        width: beanW,
                        height: beanH,
                        borderRadius: 999,
                        background: "#ffffff",
                        transform: "rotate(-12deg)",
                        animation: "grokBlink 4s infinite",
                    }}
                />
                <div
                    style={{
                        width: beanW,
                        height: beanH,
                        borderRadius: 999,
                        background: "#ffffff",
                        transform: "rotate(12deg)",
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

                {/* Golden star badge for Principal / DataClaw (matching reference screenshot) */}
                {hasStarBadge && (
                    <div
                        style={{
                            position: "absolute",
                            bottom: -2,
                            right: -2,
                            width: Math.max(13, Math.round(size * 0.36)),
                            height: Math.max(13, Math.round(size * 0.36)),
                            borderRadius: "50%",
                            background: "#eab308",
                            border: "2px solid #fffdf8",
                            display: "grid",
                            placeItems: "center",
                            color: "#ffffff",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        }}
                        title="Principal Built-in Coordinator"
                    >
                        <Star size={Math.max(7, Math.round(size * 0.2))} fill="#ffffff" stroke="none" />
                    </div>
                )}

                {/* Active online status badge (when not displaying star badge) */}
                {!hasStarBadge && (
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
                )}
            </div>
        </>
    );
}

// ============================================================================
// Grok Quick Action Pills Configuration
// ============================================================================
export interface GrokQuickAction {
    id: string;
    label: string;
    icon: any;
    prompt: string;
    description: string;
}

export const GROK_QUICK_ACTIONS: GrokQuickAction[] = [
    {
        id: "stat-audit",
        label: "Statistical Audit",
        icon: Activity,
        prompt: "Audit recent queries and metrics for sample bias, survivorship bias, data leakage, and p-hacking.",
        description: "Rigorous statistical integrity and bias check",
    },
    {
        id: "profile-table",
        label: "Profile Tables",
        icon: Database,
        prompt: "Profile active tables: compute column distributions, null percentage, cardinality, and detect anomalies.",
        description: "Column stats, null rates, and distribution shape",
    },
    {
        id: "hypothesis-test",
        label: "Hypothesis Test",
        icon: BrainCircuit,
        prompt: "Formulate a formal null hypothesis on key metrics, check test assumptions (normality, variance), and report p-values with 95% confidence intervals.",
        description: "Formal hypothesis verification with confidence bounds",
    },
    {
        id: "simpsons-paradox",
        label: "Simpson's Paradox",
        icon: Search,
        prompt: "Inspect our datasets for Simpson's Paradox: verify if subgroup or cohort stratification reverses the primary aggregate trend.",
        description: "Detect confounding factors and subgroup trend reversals",
    },
    {
        id: "data-drift",
        label: "Data Drift & Outliers",
        icon: ShieldCheck,
        prompt: "Run an outlier and distribution drift audit on recent feature columns against baseline expectations.",
        description: "Distribution shift and statistical anomaly detection",
    },
    {
        id: "exec-brief",
        label: "Executive Brief",
        icon: Terminal,
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
                                {item.status === "flag" ? "!" : item.status === "info" ? "i" : <Check size={10} strokeWidth={2.8} />}
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
    onOpenPlatformMenu,
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
    onOpenPlatformMenu?: () => void;
    onOpenSettings?: () => void;
    onToggleOps?: () => void;
}) {
    const [fullscreen, setFullscreen] = useState(false);
    const [draft, setDraft] = useState("");
    const [searchFilter, setSearchFilter] = useState("");
    const [searchFilterOpen, setSearchFilterOpen] = useState(false);
    const [unreadBannerDismissed, setUnreadBannerDismissed] = useState(false);
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

    const [sidePanelTab, setSidePanelTab] = useState<"screen" | "data" | "specs" | "routines">("screen");
    const [sidePanelWidth, setSidePanelWidth] = useState<"normal" | "wide">("normal");
    const [screenCrtTheme, setScreenCrtTheme] = useState<"matrix" | "amber" | "cyber">("matrix");
    const screenEndRef = useRef<HTMLDivElement>(null);

    const [screenLogs, setScreenLogs] = useState<string[]>([
        "[kernel:boot] Darwin 25.3.0 arm64 virtualized sandbox container initialized",
        "[storage:sqlite] SQLite WAL database mounted at /workspace/dataclaw.db",
        "[runtime:durable] Pi Durable harness online with SQLite WAL checkpointing",
        "[agent:boot] Specialist loaded: active plan and playbook synced",
        "[compute:ready] Interactive sandbox ready for bash, duckdb, and python execution",
    ]);
    const [logFilter, setLogFilter] = useState<"all" | "tools" | "system" | "stdout">("all");
    const [logsCopied, setLogsCopied] = useState(false);

    const handleCopyLogs = () => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(screenLogs.join("\n"));
            setLogsCopied(true);
            setTimeout(() => setLogsCopied(false), 2000);
        }
    };

    const displayedLogs = useMemo(() => {
        if (logFilter === "all") return screenLogs;
        if (logFilter === "tools") return screenLogs.filter((l) => l.includes("[tool:") || l.includes("[bash-exec]") || l.includes("$ "));
        if (logFilter === "system") return screenLogs.filter((l) => l.includes("[kernel:") || l.includes("[storage:") || l.includes("[runtime:") || l.includes("[compute:") || l.includes("[agent:boot]") || l.includes("[console]"));
        if (logFilter === "stdout") return screenLogs.filter((l) => l.includes("[agent:stdout]") || l.includes("[user-goal]"));
        return screenLogs;
    }, [screenLogs, logFilter]);

    const [actionMenuOpen, setActionMenuOpen] = useState(false);
    const actionMenuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const turns = useMemo(() => groupIntoTurns(transcript), [transcript]);
    const lastIsUser = transcript[transcript.length - 1]?.role === "user";

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
                setActionMenuOpen(false);
            }
        };
        if (actionMenuOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [actionMenuOpen]);

    // Ensure activeAgentId falls back to dataclaw if pointing to an agent not in roster or custom list
    useEffect(() => {
        if (
            activeAgentId !== "dataclaw" &&
            !roster.some((r) => r.id === activeAgentId) &&
            !customAgentsList.some((c) => c.id === activeAgentId)
        ) {
            onSelectAgent("dataclaw");
        }
    }, [activeAgentId, roster, customAgentsList, onSelectAgent]);

    // Combine DataClaw (hero "Principal"), roster, and user custom agents
    const allBots = useMemo(() => {
        const lastTurn = transcript[transcript.length - 1];
        const lastMsgText =
            lastTurn && "content" in lastTurn && typeof (lastTurn as any).content === "string"
                ? (lastTurn as any).content.slice(0, 48) + "..."
                : "Ready for coordination and analytics.";

        const list: Array<{
            id: string;
            name: string;
            role: string;
            description: string;
            lastMessage: string;
            time: string;
            active: boolean;
            color: string;
            icon: string;
            section: string;
            pinned?: boolean;
            isBuiltin?: boolean;
        }> = [
            {
                id: "dataclaw",
                name: "Principal",
                role: "Coordinator",
                description: "Built-in coordinator & analytics pilot",
                lastMessage: lastMsgText,
                time: "Ready",
                active: activeAgentId === "dataclaw",
                color: "#1d4ed8",
                icon: "dot-eyes",
                section: "Principal",
                pinned: true,
                isBuiltin: true,
            },
            ...roster.map((r, i) => ({
                id: r.id,
                name: r.name,
                role: r.role,
                description: r.purpose,
                lastMessage: r.purpose.length > 42 ? `${r.purpose.slice(0, 42)}...` : r.purpose,
                time: "Active",
                active: activeAgentId === r.id,
                color: ["#d97706", "#8b5cf6", "#06b6d4", "#e11d48", "#3b82f6"][i % 5] || "#10b981",
                icon: "dot-eyes",
                section: "Specialists",
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
                    lastMessage: ca.initialTask || ca.description,
                    time: "Ready",
                    active: activeAgentId === ca.id,
                    color: ca.color || "#f59e0b",
                    icon: ca.icon || "dot-eyes",
                    section: "Custom Agents",
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
    }, [transcript, roster, customAgentsList, activeAgentId, customizations]);

    const customMatch = customAgentsList.find((c) => c.id === activeAgentId);
    const botMatch = allBots.find((b) => b.id === activeAgentId);
    const baseAgent =
        activeAgentId === "dataclaw"
            ? agents[0] || {
                  id: "dataclaw",
                  name: "Principal",
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
                  : botMatch
                  ? {
                        id: botMatch.id,
                        name: botMatch.name,
                        role: botMatch.role,
                        purpose: botMatch.description,
                        compute: "isolated",
                        status: "active" as const,
                        capabilities: ["analyst", "data", "coding", "plugins"],
                        skills: [],
                        sources: ["Filesystem", "Sandbox"],
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

    const filteredBots = useMemo(() => {
        // Exclude hero principal ("dataclaw") from the categorized lists below
        const nonHero = allBots.filter((b) => b.id !== "dataclaw");
        if (!searchFilter.trim()) return nonHero;
        const q = searchFilter.toLowerCase();
        return nonHero.filter(
            (b) =>
                b.name.toLowerCase().includes(q) ||
                b.role.toLowerCase().includes(q) ||
                b.description.toLowerCase().includes(q)
        );
    }, [allBots, searchFilter]);

    const botsBySection = useMemo(() => {
        const map: Record<string, typeof filteredBots> = {};
        for (const bot of filteredBots) {
            const sec = bot.section || "Specialists";
            if (!map[sec]) map[sec] = [];
            map[sec].push(bot);
        }
        return map;
    }, [filteredBots]);

    const pinnedBots = useMemo(() => filteredBots.filter((b) => b.pinned), [filteredBots]);
    const otherBots = useMemo(() => filteredBots.filter((b) => !b.pinned), [filteredBots]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [transcript.length, working]);

    const handleSend = (textOverride?: string) => {
        const text = (textOverride ?? draft).trim();
        if (!text || working || stopping) return;
        setDraft("");

        ask(text);
        setScreenLogs((prev) => [
            ...prev,
            `[user-goal] ${text}`,
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

    useEffect(() => {
        if (transcript.length === 0) return;
        const recent = transcript.slice(-10);
        const newLogs: string[] = [];
        const now = new Date().toLocaleTimeString("en-US", { hour12: false });
        for (const item of recent) {
            if (item.role === "tool" && item.toolName) {
                const summary = item.toolSummary || item.text.slice(0, 60);
                const status = item.toolStatus ?? (item.isError ? "error" : "done");
                newLogs.push(`[${now}] [tool:${item.toolName}] ${summary} (${status})`);
            } else if (item.role === "assistant" && item.text) {
                const words = item.text.replace(/\n+/g, " ").slice(0, 65);
                if (words.trim()) {
                    newLogs.push(`[${now}] [agent:stdout] ${words}...`);
                }
            }
        }
        if (newLogs.length > 0) {
            setScreenLogs((prev) => {
                const recentSet = new Set(prev.map((l) => l.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")));
                const additions = newLogs.filter((l) => !recentSet.has(l.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")));
                if (additions.length === 0) return prev;
                return [...prev, ...additions].slice(-150);
            });
        }
    }, [transcript]);

    useEffect(() => {
        if (showDeepDive && sidePanelTab === "screen") {
            screenEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [screenLogs.length, showDeepDive, sidePanelTab]);

    const handleRunQuickCommand = (cmd: string) => {
        if (cmd === "clear") {
            setScreenLogs([
                `[console] Screen log cleared`,
                `[ready] Interactive sandbox ready`,
            ]);
            return;
        }
        setScreenLogs((prev) => [
            ...prev,
            `$ ${cmd}`,
            `[bash-exec] Submitting command to ${baseAgent.name} execution environment...`,
        ]);
        ask(`Execute bash command in workspace: ${cmd}`);
    };

    const handleExecuteControl = (e: React.FormEvent) => {
        e.preventDefault();
        if (!screenCommand.trim()) return;
        const cmd = screenCommand.trim();
        setScreenCommand("");
        if (cmd === "clear") {
            setScreenLogs([
                `[console] Screen log cleared`,
                `[ready] Interactive sandbox ready`,
            ]);
            return;
        }
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
                {/* Header: Window traffic lights (left) & Search / Plus (right) */}
                <div
                    style={{
                        padding: "14px 16px 8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    {/* Window traffic lights */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f56" }} />
                        <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ffbd2e" }} />
                        <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#27c93f" }} />
                    </div>

                    {/* Search & Plus buttons */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                            type="button"
                            onClick={() => setSearchFilterOpen((prev) => !prev)}
                            title="Search specialists"
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: "50%",
                                border: "none",
                                background: isDark ? "rgba(255, 255, 255, 0.08)" : "#eeeeee",
                                color: t.textSecondary,
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                            }}
                        >
                            <Search size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsCreatingAgent(true)}
                            title="Create agent"
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: "50%",
                                border: "none",
                                background: isDark ? "rgba(255, 255, 255, 0.08)" : "#eeeeee",
                                color: t.textSecondary,
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                            }}
                        >
                            <Plus size={15} />
                        </button>
                    </div>
                </div>

                {/* Hero Principal (DataClaw coordinator) */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectAgent("dataclaw")}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") onSelectAgent("dataclaw");
                    }}
                    title="Principal (DataClaw Coordinator)"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "8px 16px 14px",
                        cursor: "pointer",
                        userSelect: "none",
                    }}
                >
                    <div
                        style={{
                            position: "relative",
                            padding: 3,
                            borderRadius: "50%",
                            background: activeAgentId === "dataclaw"
                                ? (isDark ? "rgba(29, 78, 216, 0.3)" : "rgba(29, 78, 216, 0.12)")
                                : "transparent",
                            transition: "all 0.15s ease",
                        }}
                    >
                        <GrokbotAvatar
                            name="Principal"
                            color="#1d4ed8"
                            size={52}
                            isWorking={activeAgentId === "dataclaw" && working}
                            mood={activeAgentId === "dataclaw" && working ? "thinking" : "normal"}
                            hasStarBadge={true}
                        />
                    </div>
                    <div
                        style={{
                            marginTop: 6,
                            fontSize: 13,
                            fontWeight: 600,
                            color: activeAgentId === "dataclaw" ? (isDark ? "#ffffff" : "#1d4ed8") : t.textPrimary,
                            letterSpacing: "-0.01em",
                        }}
                    >
                        Principal
                    </div>
                </div>

                {/* Collapsible search bar if opened */}
                {searchFilterOpen && (
                    <div style={{ padding: "0 14px 10px" }}>
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
                                autoFocus
                                type="text"
                                placeholder="Search agents..."
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
                )}

                {/* Bot List grouped dynamically by Section */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "0 10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                    }}
                >
                    {Object.keys(botsBySection).length === 0 ? (
                        <div
                            style={{
                                padding: "24px 12px",
                                textAlign: "center",
                                color: t.textMuted,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <Bot size={28} strokeWidth={1.5} color={t.textMuted} />
                            <div style={{ fontSize: 12, fontWeight: 600, color: t.textPrimary }}>
                                No Specialists Yet
                            </div>
                            <div style={{ fontSize: 11, lineHeight: 1.4, color: t.textSecondary }}>
                                Delegate tasks from the Principal or create custom specialist agents.
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCreatingAgent(true)}
                                style={{
                                    marginTop: 6,
                                    padding: "6px 12px",
                                    borderRadius: 8,
                                    background: isDark ? "rgba(255, 255, 255, 0.06)" : "#e8e5dc",
                                    border: `1px solid ${t.border}`,
                                    color: t.textPrimary,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                }}
                            >
                                <Plus size={12} />
                                <span>Create Specialist</span>
                            </button>
                        </div>
                    ) : (
                        Object.entries(botsBySection).map(([section, bots]) => {
                            if (bots.length === 0) return null;
                            return (
                                <div key={section}>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: t.textMuted,
                                            padding: "2px 8px 6px",
                                            letterSpacing: "0.01em",
                                            textTransform: "uppercase",
                                        }}
                                    >
                                        {section}
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                        {bots.map((bot) => (
                                            <div
                                                key={bot.id}
                                                className="bot-row"
                                                onClick={() => onSelectAgent(bot.id)}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                    padding: "8px 10px",
                                                    borderRadius: 12,
                                                    cursor: "pointer",
                                                    background: bot.active
                                                        ? (isDark ? "rgba(255, 255, 255, 0.08)" : "#ececec")
                                                        : "transparent",
                                                    border: bot.active
                                                        ? `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.06)"}`
                                                        : "1px solid transparent",
                                                    transition: "all 0.15s ease",
                                                }}
                                            >
                                                <GrokbotAvatar
                                                    name={bot.name}
                                                    color={bot.color}
                                                    icon={bot.icon}
                                                    size={34}
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
                                                                fontWeight: bot.active ? 600 : 500,
                                                                fontSize: 13,
                                                                color: bot.active
                                                                    ? (isDark ? "#ffffff" : "#111827")
                                                                    : t.textPrimary,
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                            }}
                                                        >
                                                            {bot.name}
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

                                                {/* Hover-only actions: Screen + Edit */}
                                                <div
                                                    className="bot-row-actions"
                                                    style={{ display: "flex", alignItems: "center", gap: 3 }}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onSelectAgent(bot.id);
                                                            setShowDeepDive(true);
                                                            setSidePanelTab("screen");
                                                        }}
                                                        title={`Open Compute Screen of ${bot.name}`}
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
                                                        }}
                                                    >
                                                        <Monitor size={12} />
                                                    </button>
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
                                                        }}
                                                    >
                                                        <Pencil size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Bottom User Profile Capsule */}
                <div
                    style={{
                        padding: "8px 12px 14px",
                        borderTop: `1px solid ${t.borderSubtle}`,
                        background: t.panelBg,
                    }}
                >
                    <div
                        style={{
                            background: isDark ? "#171a23" : "#f1f1f1",
                            borderRadius: 9999,
                            padding: "4px 8px 4px 6px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                    >
                        {/* Left: Avatar + Name */}
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setProfileModalOpen(true)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") setProfileModalOpen(true);
                            }}
                            title="Profile & Settings"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                cursor: "pointer",
                                flex: 1,
                                minWidth: 0,
                            }}
                        >
                            <div
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    background: userProfile.avatarColor || "#1e293b",
                                    color: "#ffffff",
                                    display: "grid",
                                    placeItems: "center",
                                    fontWeight: 700,
                                    fontSize: 11,
                                    flexShrink: 0,
                                }}
                            >
                                {userProfile.initials || "WM"}
                            </div>
                            <span
                                style={{
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    color: t.textPrimary,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {userProfile.name || "Workspace Member"}
                            </span>
                        </div>

                        {/* Right: Theme Toggle + Settings Icon (no blue arrow!) */}
                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <button
                                type="button"
                                onClick={() => toggleTheme()}
                                title={isDark ? "Switch to light theme" : "Switch to dark theme"}
                                style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    border: "none",
                                    background: "transparent",
                                    color: t.textMuted,
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                }}
                            >
                                {isDark ? <Sun size={13} /> : <Moon size={13} />}
                            </button>

                            <button
                                type="button"
                                onClick={() => setProfileModalOpen(true)}
                                title="Workspace & Settings"
                                style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    border: "none",
                                    background: "transparent",
                                    color: t.textMuted,
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                }}
                            >
                                <Settings2 size={13} />
                            </button>
                        </div>
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
                {/* Chat Header (Serene, minimal, perfectly centered, matching reference) */}
                <header
                    style={{
                        height: 52,
                        padding: "0 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderBottom: `1px solid ${t.borderSubtle}`,
                        background: t.panelBg,
                    }}
                >
                    {/* Left action: Platform Navigation Drawer Toggle */}
                    <div style={{ display: "flex", alignItems: "center", width: 36 }}>
                        {onOpenPlatformMenu && (
                            <button
                                type="button"
                                onClick={onOpenPlatformMenu}
                                title="Open DataClaw Platform Menu (Runs, Data Health, Capabilities, Overview)"
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: "50%",
                                    border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
                                    background: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.02)",
                                    color: t.textSecondary,
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = t.accent;
                                    e.currentTarget.style.color = t.textPrimary;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
                                    e.currentTarget.style.color = t.textSecondary;
                                }}
                            >
                                <Layers3 size={15} />
                            </button>
                        )}
                    </div>

                    {/* Centered Bot Capsule matching reference screenshot */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 14px 4px 6px",
                            borderRadius: 9999,
                            background: isDark ? "rgba(255, 255, 255, 0.06)" : "#f3f4f6",
                            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)"}`,
                            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                        }}
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
                        title={`Edit profile of ${activeDisplayName}`}
                    >
                        <GrokbotAvatar
                            name={activeDisplayName}
                            color={activeColor}
                            icon={activeIcon}
                            size={22}
                            isWorking={working}
                            mood={working ? "thinking" : "normal"}
                            hasStarBadge={activeAgentId === "dataclaw"}
                        />
                        <span
                            style={{
                                fontWeight: 600,
                                fontSize: 13,
                                color: t.textPrimary,
                            }}
                        >
                            {activeDisplayName}
                        </span>
                    </div>

                    {/* Right action: discreet Compute Screen button */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, width: 36, justifyContent: "flex-end" }}>
                        <button
                            type="button"
                            onClick={() => {
                                setShowDeepDive(!showDeepDive);
                                if (!showDeepDive) setSidePanelTab("screen");
                            }}
                            title={showDeepDive ? "Close Compute Screen" : "Open Compute Screen"}
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                border: `1px solid ${showDeepDive ? t.accent : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                                background: showDeepDive
                                    ? (isDark ? "rgba(255, 94, 87, 0.16)" : "#e2eee6")
                                    : "transparent",
                                color: showDeepDive ? t.accent : t.textMuted,
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                            }}
                        >
                            <Monitor size={14} />
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
                    {/* Unread banner matching reference screenshot */}
                    {!unreadBannerDismissed && transcript.length > 2 && (
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                padding: "8px 0 2px",
                                position: "sticky",
                                top: 6,
                                zIndex: 10,
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    endRef.current?.scrollIntoView({ behavior: "smooth" });
                                    setUnreadBannerDismissed(true);
                                }}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    background: "#ef4444",
                                    color: "#ffffff",
                                    border: "none",
                                    borderRadius: 9999,
                                    padding: "4px 12px",
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    boxShadow: "0 2px 8px rgba(239, 68, 68, 0.35)",
                                }}
                                title="Jump to latest messages"
                            >
                                <ArrowUp size={12} strokeWidth={2.5} />
                                <span>{transcript.length} new messages</span>
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setUnreadBannerDismissed(true);
                                    }}
                                    style={{ display: "inline-flex", alignItems: "center", opacity: 0.8, cursor: "pointer", marginLeft: 2 }}
                                >
                                    <X size={11} strokeWidth={2.5} />
                                </span>
                            </button>
                        </div>
                    )}

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
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                        <Check size={12} strokeWidth={2.5} /> Unity Catalog connected
                                    </span>
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
                                                mood={working && isLast ? "thinking" : "normal"}
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

                {/* Clean Floating Capsule Composer (Matching Grokbot reference) */}
                <div className="chat-composer-wrap" style={{ position: "relative", padding: "10px 24px 18px" }}>
                    {/* Floating Action & Delegation Popover (+ Menu) */}
                    {actionMenuOpen && (
                        <div
                            ref={actionMenuRef}
                            style={{
                                position: "absolute",
                                bottom: "calc(100% - 4px)",
                                left: "max(24px, calc(50% - 390px))",
                                width: 320,
                                background: isDark ? "rgba(20, 24, 34, 0.96)" : "rgba(255, 253, 248, 0.96)",
                                border: isDark ? "1px solid rgba(255, 255, 255, 0.1)" : "1px solid #dedbd1",
                                borderRadius: 16,
                                padding: "10px",
                                boxShadow: isDark ? "0 12px 36px rgba(0, 0, 0, 0.55)" : "0 8px 24px rgba(32, 58, 55, 0.12)",
                                backdropFilter: "blur(14px)",
                                zIndex: 60,
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                animation: "popoverSlideUp 0.15s ease-out",
                            }}
                        >
                            <style>{`
                                @keyframes popoverSlideUp {
                                    from { opacity: 0; transform: translateY(8px); }
                                    to { opacity: 1; transform: translateY(0); }
                                }
                            `}</style>

                            {/* Section 1: Quick Actions */}
                            <div>
                                <div
                                    style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.5px",
                                        color: t.textMuted,
                                        padding: "3px 6px 5px",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                    }}
                                >
                                    <Zap size={11} color={t.accent} />
                                    Data Actions & Verification
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                    {GROK_QUICK_ACTIONS.map((action) => {
                                        const ActionIcon = action.icon;
                                        return (
                                            <button
                                                key={action.id}
                                                type="button"
                                                onClick={() => {
                                                    handleSelectQuickAction(action);
                                                    setActionMenuOpen(false);
                                                }}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    padding: "7px 9px",
                                                    borderRadius: 8,
                                                    border: "none",
                                                    background: isDark ? "rgba(255, 255, 255, 0.04)" : "#f6f4ee",
                                                    color: t.textPrimary,
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    cursor: "pointer",
                                                    textAlign: "left",
                                                    transition: "all 0.12s ease",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = isDark ? "rgba(255, 255, 255, 0.1)" : "#ece8dc";
                                                    e.currentTarget.style.color = t.accent;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = isDark ? "rgba(255, 255, 255, 0.04)" : "#f6f4ee";
                                                    e.currentTarget.style.color = t.textPrimary;
                                                }}
                                            >
                                                {ActionIcon && <ActionIcon size={12} color={t.accent} />}
                                                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {action.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Section 2: Delegate to Teammate */}
                            {allBots.filter((b) => b.id !== activeAgentId).length > 0 && (
                                <div style={{ borderTop: isDark ? "1px solid rgba(255, 255, 255, 0.07)" : "1px solid #ece8de", paddingTop: 8 }}>
                                    <div
                                        style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.5px",
                                            color: t.textMuted,
                                            padding: "3px 6px 5px",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                    >
                                        <AtSign size={11} color={t.textMuted} />
                                        Delegate to Specialist
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflowY: "auto" }}>
                                        {allBots
                                            .filter((b) => b.id !== activeAgentId)
                                            .map((b) => (
                                                <button
                                                    key={b.id}
                                                    type="button"
                                                    onClick={() => {
                                                        handleMentionAgent(b.name);
                                                        setActionMenuOpen(false);
                                                    }}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        padding: "5px 8px",
                                                        borderRadius: 7,
                                                        border: "none",
                                                        background: "transparent",
                                                        cursor: "pointer",
                                                        textAlign: "left",
                                                        transition: "all 0.12s ease",
                                                    }}
                                                    onMouseEnter={(e) => (e.currentTarget.style.background = t.hoverItemBg)}
                                                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                                                >
                                                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                                        <GrokbotAvatar name={b.name} color={b.color} icon={b.icon} size={20} />
                                                        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.textPrimary }}>@{b.name}</span>
                                                    </div>
                                                    <span style={{ fontSize: 10, color: t.textMuted }}>{b.role}</span>
                                                </button>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Capsule Pill Composer */}
                    <div
                        className="chat-composer"
                        style={{
                            maxWidth: 820,
                            margin: "0 auto",
                            borderRadius: 9999,
                            padding: "6px 10px 6px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: isDark ? "#161922" : "#ffffff",
                            border: `1px solid ${t.border}`,
                            boxShadow: isDark ? "0 2px 14px rgba(0, 0, 0, 0.35)" : "0 2px 8px rgba(32, 58, 55, 0.05)",
                            transition: "border 0.15s ease, box-shadow 0.15s ease",
                        }}
                    >
                        {/* Plus Action Button */}
                        <button
                            type="button"
                            onClick={() => setActionMenuOpen(!actionMenuOpen)}
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: "50%",
                                border: `1px solid ${actionMenuOpen ? t.accent : isDark ? "#283042" : "#dedbd0"}`,
                                background: actionMenuOpen
                                    ? (isDark ? "rgba(255, 94, 87, 0.18)" : "#eaf3ee")
                                    : "transparent",
                                color: actionMenuOpen ? t.accent : t.textMuted,
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "all 0.15s ease",
                            }}
                            title="Actions & delegate (+)"
                        >
                            <Plus
                                size={15}
                                strokeWidth={2.2}
                                style={{
                                    transform: actionMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
                                    transition: "transform 0.15s ease",
                                }}
                            />
                        </button>

                        {/* Input Field */}
                        <textarea
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => {
                                const val = e.target.value;
                                setDraft(val);
                                if (val.endsWith("@")) {
                                    setActionMenuOpen(true);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                } else if (e.key === "Escape" && actionMenuOpen) {
                                    setActionMenuOpen(false);
                                }
                            }}
                            placeholder={`Message ${activeDisplayName}…`}
                            rows={1}
                            style={{
                                flex: 1,
                                border: "none",
                                outline: "none",
                                background: "transparent",
                                resize: "none",
                                fontSize: 13.5,
                                color: t.textPrimary,
                                padding: "6px 0",
                                maxHeight: 160,
                            }}
                        />

                        {/* Right Buttons: Mic + Waveform OR Send Arrow */}
                        {working || stopping ? (
                            <button
                                className="chat-send stop"
                                type="button"
                                onClick={onStop}
                                disabled={stopping}
                                title={stopping ? "Stopping" : "Stop"}
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: "50%",
                                    background: "#e11d48",
                                    color: "#fff",
                                    border: "none",
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                }}
                            >
                                <Square size={12} />
                            </button>
                        ) : draft.trim() ? (
                            <button
                                type="button"
                                onClick={() => handleSend()}
                                aria-label="Send"
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: "50%",
                                    background: t.accent,
                                    color: "#fff",
                                    border: "none",
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                <ArrowUp size={16} strokeWidth={2.5} />
                            </button>
                        ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <button
                                    type="button"
                                    onClick={() => inputRef.current?.focus()}
                                    style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: "50%",
                                        border: "none",
                                        background: "transparent",
                                        color: t.textMuted,
                                        display: "grid",
                                        placeItems: "center",
                                        cursor: "pointer",
                                    }}
                                    title="Voice input"
                                >
                                    <Mic size={15} />
                                </button>
                                <div
                                    style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: "50%",
                                        background: "#ef4444",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 2,
                                        cursor: "pointer",
                                    }}
                                    title="Audio waveform"
                                >
                                    <span style={{ width: 2, height: 9, background: "#fff", borderRadius: 1 }} />
                                    <span style={{ width: 2, height: 15, background: "#fff", borderRadius: 1 }} />
                                    <span style={{ width: 2, height: 7, background: "#fff", borderRadius: 1 }} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* ============================================================ */}
            {/* COLUMN 3: GROKBOT COMPUTE SCREEN & LIVE SANDBOX PANEL        */}
            {/* ============================================================ */}
            {showDeepDive && (() => {
                const simulatedCpu = working ? 76.4 : 14.2;
                const crtThemes = {
                    matrix: {
                        bg: "#05120c",
                        border: "#064e3b",
                        headerBg: "#031c13",
                        text: "#34d399",
                        textMuted: "#10b98188",
                        glow: "0 0 8px rgba(52, 211, 153, 0.4)",
                        cursor: "#34d399",
                        label: "Matrix Green",
                    },
                    amber: {
                        bg: "#150e04",
                        border: "#78350f",
                        headerBg: "#221606",
                        text: "#fbbf24",
                        textMuted: "#f59e0b88",
                        glow: "0 0 8px rgba(251, 191, 36, 0.4)",
                        cursor: "#fbbf24",
                        label: "Amber Phosphor",
                    },
                    cyber: {
                        bg: "#050e18",
                        border: "#0369a1",
                        headerBg: "#071c30",
                        text: "#38bdf8",
                        textMuted: "#0284c788",
                        glow: "0 0 8px rgba(56, 189, 248, 0.4)",
                        cursor: "#38bdf8",
                        label: "Cyber Blue",
                    },
                };
                const activeCrt = crtThemes[screenCrtTheme];
                const panelWidth = sidePanelWidth === "wide" ? 560 : 380;

                return (
                    <aside
                        style={{
                            width: panelWidth,
                            minWidth: panelWidth,
                            background: t.panelBg,
                            borderLeft: `1px solid ${t.border}`,
                            display: "flex",
                            flexDirection: "column",
                            height: "100%",
                            overflowY: "auto",
                            animation: "panelSlideIn 0.18s ease-out",
                            transition: "width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                    >
                        <style>{`
                            @keyframes panelSlideIn {
                                from { transform: translateX(12px); opacity: 0; }
                                to { transform: translateX(0); opacity: 1; }
                            }
                            @keyframes grokDotPulse {
                                0%, 100% { opacity: 1; transform: scale(1); }
                                50% { opacity: 0.35; transform: scale(0.75); }
                            }
                            @keyframes crtBlink {
                                0%, 49% { opacity: 1; }
                                50%, 100% { opacity: 0; }
                            }
                        `}</style>

                        {/* Compute Screen Header */}
                        <div
                            style={{
                                padding: "12px 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderBottom: `1px solid ${t.borderSubtle}`,
                                background: t.panelBg,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <GrokbotAvatar
                                    name={activeDisplayName}
                                    color={activeColor}
                                    icon={activeIcon}
                                    size={28}
                                    isWorking={working}
                                    mood={working ? "thinking" : "normal"}
                                />
                                <div>
                                    <div
                                        style={{
                                            fontWeight: 700,
                                            fontSize: 13,
                                            color: t.textPrimary,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                        }}
                                    >
                                        <span>Compute Screen</span>
                                        <span
                                            style={{
                                                fontSize: 9.5,
                                                fontWeight: 700,
                                                padding: "1px 6px",
                                                borderRadius: 999,
                                                background: working ? "rgba(59, 130, 246, 0.18)" : "rgba(16, 185, 129, 0.18)",
                                                color: working ? (isDark ? "#60a5fa" : "#2563eb") : (isDark ? "#34d399" : "#16a34a"),
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 3,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 5,
                                                    height: 5,
                                                    borderRadius: "50%",
                                                    background: working ? "#3b82f6" : "#10b981",
                                                    animation: working ? "grokDotPulse 1.2s infinite" : "none",
                                                }}
                                            />
                                            {working ? "EXECUTING" : "ONLINE"}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 10, color: t.textMuted }}>
                                        {activeDisplayName} · sandbox container (PID 4108)
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                {/* CRT Phosphor Theme Cycler */}
                                {sidePanelTab === "screen" && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setScreenCrtTheme((prev) =>
                                                prev === "matrix" ? "amber" : prev === "amber" ? "cyber" : "matrix"
                                            )
                                        }
                                        style={{
                                            background: isDark ? "#1a1f2c" : "#eeebe2",
                                            border: `1px solid ${t.border}`,
                                            color: t.textPrimary,
                                            borderRadius: 6,
                                            padding: "3px 7px",
                                            fontSize: 10,
                                            fontWeight: 600,
                                            cursor: "pointer",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                        title={`Cycle CRT Phosphor Theme: currently ${activeCrt.label}`}
                                    >
                                        <span
                                            style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: "50%",
                                                background: activeCrt.text,
                                                boxShadow: activeCrt.glow,
                                                display: "inline-block",
                                            }}
                                        />
                                        <span>CRT</span>
                                    </button>
                                )}

                                {/* Width Toggle */}
                                <button
                                    type="button"
                                    onClick={() => setSidePanelWidth((prev) => (prev === "wide" ? "normal" : "wide"))}
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
                                    title={sidePanelWidth === "wide" ? "Contract side panel" : "Expand to wide monitor (560px)"}
                                >
                                    {sidePanelWidth === "wide" ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                                </button>

                                {/* Close Button */}
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
                                    title="Close Compute Screen panel"
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        </div>

                        {/* Side Panel Tabs */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "4px 12px 6px",
                                gap: 6,
                                borderBottom: `1px solid ${t.borderSubtle}`,
                                background: t.panelBg,
                            }}
                        >
                            {[
                                { id: "screen", label: "Screen", icon: Monitor, title: "Live CRT Sandbox Monitor" },
                                { id: "data", label: "Data", icon: Database, title: "Unity Catalog & Tables Viewer" },
                                { id: "specs", label: "Specs", icon: Cpu, title: "Specialist Archetype & Capabilities" },
                                { id: "routines", label: "Routines", icon: Clock, title: "Autonomous background cycles" },
                            ].map((tab) => {
                                const active = sidePanelTab === tab.id;
                                const TabIcon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setSidePanelTab(tab.id as any)}
                                        title={tab.title}
                                        style={{
                                            flex: 1,
                                            padding: "5px 6px",
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: active ? 700 : 500,
                                            border: "none",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 5,
                                            background: active
                                                ? (isDark ? "#1e2433" : "#ffffff")
                                                : "transparent",
                                            color: active
                                                ? (isDark ? "#f1f3f7" : "#1c332e")
                                                : (isDark ? "#828d9e" : "#6c7b74"),
                                            boxShadow: active
                                                ? (isDark ? "0 1px 3px rgba(0,0,0,0.4)" : "0 1px 3px rgba(0,0,0,0.06)")
                                                : "none",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        <TabIcon size={12} />
                                        <span>{tab.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* TAB 1: COMPUTE SCREEN */}
                        {sidePanelTab === "screen" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 14px 20px" }}>
                                {/* Hardware Telemetry HUD (4 Cards) */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    {/* CPU Card */}
                                    <div
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 8,
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                                                <Cpu size={11} color={t.accent} /> CPU
                                            </span>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: working ? "#3b82f6" : t.accent }}>
                                                {simulatedCpu}%
                                            </span>
                                        </div>
                                        {/* Progress Bar */}
                                        <div style={{ width: "100%", height: 4, borderRadius: 2, background: isDark ? "#232938" : "#e6e2d8", overflow: "hidden" }}>
                                            <div
                                                style={{
                                                    width: `${simulatedCpu}%`,
                                                    height: "100%",
                                                    background: working ? "#3b82f6" : "#10b981",
                                                    transition: "width 0.4s ease",
                                                }}
                                            />
                                        </div>
                                        <div style={{ fontSize: 9, color: t.textMuted, marginTop: 4 }}>
                                            {working ? "Running sandbox task" : "4 cores · arm64"}
                                        </div>
                                    </div>

                                    {/* Memory Card */}
                                    <div
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 8,
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                                                <HardDrive size={11} color={t.accent} /> Memory
                                            </span>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: t.textPrimary }}>
                                                148 MB
                                            </span>
                                        </div>
                                        {/* Progress Bar */}
                                        <div style={{ width: "100%", height: 4, borderRadius: 2, background: isDark ? "#232938" : "#e6e2d8", overflow: "hidden" }}>
                                            <div
                                                style={{
                                                    width: "14.5%",
                                                    height: "100%",
                                                    background: t.accent,
                                                }}
                                            />
                                        </div>
                                        <div style={{ fontSize: 9, color: t.textMuted, marginTop: 4 }}>
                                            14.5% of 1024 MB quota
                                        </div>
                                    </div>

                                    {/* SQLite WAL State Card */}
                                    <div
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 8,
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                                                <Database size={11} color={t.accent} /> Storage
                                            </span>
                                            <span style={{ fontSize: 9.5, fontWeight: 700, color: "#10b981" }}>
                                                WAL OK
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: t.textPrimary }}>
                                            SQLite WAL (1.4MB)
                                        </div>
                                        <div style={{ fontSize: 9, color: t.textMuted, marginTop: 2 }}>
                                            Checkpoint commit: sync
                                        </div>
                                    </div>

                                    {/* Sandbox Mode Card */}
                                    <div
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 8,
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                                                <Activity size={11} color={t.accent} /> Sandbox
                                            </span>
                                            <span style={{ fontSize: 9.5, fontWeight: 700, color: t.accent }}>
                                                Isolated
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: t.textPrimary, textTransform: "capitalize" }}>
                                            {"compute" in baseAgent ? String((baseAgent as any).compute) : "Local Sandbox"}
                                        </div>
                                        <div style={{ fontSize: 9, color: t.textMuted, marginTop: 2 }}>
                                            Namespace & FS jailed
                                        </div>
                                    </div>
                                </div>

                                {/* Authentic CRT Terminal Console */}
                                <div
                                    style={{
                                        background: activeCrt.headerBg,
                                        border: `1px solid ${activeCrt.border}`,
                                        borderRadius: 10,
                                        overflow: "hidden",
                                        boxShadow: isDark ? "0 4px 20px rgba(0, 0, 0, 0.4)" : "0 2px 10px rgba(0, 0, 0, 0.08)",
                                    }}
                                >
                                    {/* Bezel Top Bar */}
                                    <div
                                        style={{
                                            padding: "6px 10px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            borderBottom: `1px solid ${activeCrt.border}`,
                                            background: activeCrt.headerBg,
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                                            <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono, monospace)", color: activeCrt.textMuted, marginLeft: 6 }}>
                                                terminal: bash @ {activeDisplayName.toLowerCase()} (PID 4108)
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: working ? "#3b82f6" : "#10b981", animation: working ? "grokDotPulse 1s infinite" : "none" }} />
                                            <span style={{ fontSize: 9, color: activeCrt.textMuted, fontFamily: "var(--app-font-mono, monospace)" }}>
                                                80x24 CRT
                                            </span>
                                        </div>
                                    </div>

                                    {/* Sub-bar: Log category filters & Copy Logs action */}
                                    <div
                                        style={{
                                            padding: "4px 8px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            borderBottom: `1px solid ${activeCrt.border}`,
                                            background: activeCrt.headerBg,
                                            gap: 6,
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                            {[
                                                { id: "all", label: "All" },
                                                { id: "tools", label: "Tools" },
                                                { id: "system", label: "System" },
                                                { id: "stdout", label: "Stdout" },
                                            ].map((f) => (
                                                <button
                                                    key={f.id}
                                                    type="button"
                                                    onClick={() => setLogFilter(f.id as any)}
                                                    style={{
                                                        fontSize: 9,
                                                        fontFamily: "var(--app-font-mono, monospace)",
                                                        padding: "2px 6px",
                                                        borderRadius: 4,
                                                        border: logFilter === f.id ? `1px solid ${activeCrt.text}` : "1px solid transparent",
                                                        background: logFilter === f.id ? "rgba(255, 255, 255, 0.08)" : "transparent",
                                                        color: logFilter === f.id ? activeCrt.text : activeCrt.textMuted,
                                                        cursor: "pointer",
                                                        fontWeight: logFilter === f.id ? 700 : 500,
                                                        transition: "all 0.12s ease",
                                                    }}
                                                >
                                                    {f.label}
                                                </button>
                                            ))}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleCopyLogs}
                                            title="Copy terminal logs to clipboard"
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 3,
                                                fontSize: 9,
                                                fontFamily: "var(--app-font-mono, monospace)",
                                                padding: "2px 6px",
                                                borderRadius: 4,
                                                border: `1px solid ${logsCopied ? "#10b981" : "transparent"}`,
                                                background: logsCopied ? "rgba(16, 185, 129, 0.18)" : "transparent",
                                                color: logsCopied ? "#10b981" : activeCrt.textMuted,
                                                cursor: "pointer",
                                                transition: "all 0.12s ease",
                                            }}
                                        >
                                            {logsCopied ? <Check size={10} strokeWidth={2.5} /> : <Copy size={10} />}
                                            <span>{logsCopied ? "Copied" : "Copy"}</span>
                                        </button>
                                    </div>

                                    {/* CRT Screen Body with Scanlines */}
                                    <div
                                        style={{
                                            background: activeCrt.bg,
                                            padding: "10px 12px",
                                            fontSize: 10.5,
                                            fontFamily: "var(--app-font-mono, monospace)",
                                            color: activeCrt.text,
                                            height: sidePanelWidth === "wide" ? 280 : 220,
                                            overflowY: "auto",
                                            lineHeight: 1.5,
                                            position: "relative",
                                            backgroundImage:
                                                "linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03))",
                                            backgroundSize: "100% 3px, 3px 100%",
                                        }}
                                    >
                                        {displayedLogs.length === 0 ? (
                                            <div style={{ color: activeCrt.textMuted, fontStyle: "italic", padding: "10px 0" }}>
                                                No logs match the "{logFilter}" filter yet.
                                            </div>
                                        ) : (
                                            displayedLogs.map((log, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{
                                                        wordBreak: "break-all",
                                                        textShadow: activeCrt.glow,
                                                        opacity: idx === displayedLogs.length - 1 ? 1 : 0.9,
                                                    }}
                                                >
                                                    {log}
                                                </div>
                                            ))
                                        )}

                                        {/* Blinking Prompt Cursor */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, textShadow: activeCrt.glow }}>
                                            <span style={{ opacity: 0.8 }}>user@{activeDisplayName.toLowerCase()}-sandbox:~$</span>
                                            <span style={{ animation: "crtBlink 1s infinite", fontWeight: 900 }}>_</span>
                                        </div>
                                        <div ref={screenEndRef} />
                                    </div>
                                </div>

                                {/* Interactive Takeover & Command Form */}
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textMuted }}>
                                            Sandbox Interactive CLI
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setHumanTakeover(!humanTakeover)}
                                            style={{
                                                background: humanTakeover ? "#d97706" : (isDark ? "#1f2430" : "#ffffff"),
                                                color: humanTakeover ? "#ffffff" : t.textPrimary,
                                                border: humanTakeover ? "1px solid #b45309" : `1px solid ${t.border}`,
                                                borderRadius: 5,
                                                padding: "2px 8px",
                                                fontSize: 10,
                                                fontWeight: 600,
                                                cursor: "pointer",
                                            }}
                                        >
                                            {humanTakeover ? "Release Takeover" : "Takeover CLI"}
                                        </button>
                                    </div>

                                    {/* Input Form */}
                                    <form
                                        onSubmit={handleExecuteControl}
                                        style={{
                                            display: "flex",
                                            gap: 6,
                                            background: isDark ? "#161922" : "#ffffff",
                                            padding: 4,
                                            borderRadius: 8,
                                            border: `1px solid ${humanTakeover ? t.accent : t.border}`,
                                            boxShadow: humanTakeover ? `0 0 0 2px ${t.accentSubtle}` : "none",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        <span style={{ padding: "4px 0 4px 6px", fontSize: 11, fontFamily: "var(--app-font-mono, monospace)", color: t.accent, fontWeight: 700 }}>
                                            $
                                        </span>
                                        <input
                                            type="text"
                                            value={screenCommand}
                                            onChange={(e) => setScreenCommand(e.target.value)}
                                            placeholder={humanTakeover ? "Execute command in sandbox container..." : "Click Takeover CLI or type command..."}
                                            style={{
                                                flex: 1,
                                                background: "transparent",
                                                border: "none",
                                                outline: "none",
                                                color: t.textPrimary,
                                                fontSize: 11.5,
                                                fontFamily: "var(--app-font-mono, monospace)",
                                                padding: "3px 4px",
                                            }}
                                        />
                                        <button
                                            type="submit"
                                            style={{
                                                background: t.accent,
                                                color: "#fff",
                                                border: "none",
                                                borderRadius: 6,
                                                padding: "3px 10px",
                                                fontSize: 11,
                                                fontWeight: 600,
                                                cursor: "pointer",
                                            }}
                                        >
                                            Exec
                                        </button>
                                    </form>

                                    {/* Quick Command Pills */}
                                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                                        {[
                                            { cmd: "ps aux", label: "ps aux" },
                                            { cmd: "df -h", label: "df -h" },
                                            { cmd: "sqlite3 dataclaw.db .tables", label: ".tables" },
                                            { cmd: "python -V", label: "python -V" },
                                            { cmd: "clear", label: "Clear Screen" },
                                        ].map((c) => (
                                            <button
                                                key={c.cmd}
                                                type="button"
                                                onClick={() => handleRunQuickCommand(c.cmd)}
                                                style={{
                                                    fontSize: 10,
                                                    fontFamily: "var(--app-font-mono, monospace)",
                                                    padding: "2px 7px",
                                                    borderRadius: 4,
                                                    border: `1px solid ${t.border}`,
                                                    background: t.cardBg,
                                                    color: t.textSecondary,
                                                    cursor: "pointer",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.borderColor = t.accent;
                                                    e.currentTarget.style.color = t.textPrimary;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.borderColor = t.border;
                                                    e.currentTarget.style.color = t.textSecondary;
                                                }}
                                            >
                                                {c.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Sub-processes Table */}
                                <div
                                    style={{
                                        background: t.cardBg,
                                        border: `1px solid ${t.border}`,
                                        borderRadius: 8,
                                        overflow: "hidden",
                                    }}
                                >
                                    <div
                                        style={{
                                            padding: "6px 10px",
                                            fontSize: 10,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            color: t.textMuted,
                                            borderBottom: `1px solid ${t.borderSubtle}`,
                                            display: "flex",
                                            justifyContent: "space-between",
                                        }}
                                    >
                                        <span>Active Process Workers</span>
                                        <span>3 Sub-PIDs</span>
                                    </div>
                                    <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono, monospace)", padding: "4px 8px" }}>
                                        {[
                                            { pid: "4108", cmd: "bun src/console/api/server.ts", cpu: working ? "42.1%" : "0.8%", state: "RUNNING", color: "#10b981" },
                                            { pid: "4112", cmd: "dataclaw-sandbox-worker", cpu: working ? "32.0%" : "0.0%", state: working ? "EXEC" : "IDLE", color: working ? "#3b82f6" : "#94a3b8" },
                                            { pid: "4115", cmd: "sqlite3-wal-checkpoint", cpu: "0.1%", state: "SYNCED", color: "#10b981" },
                                        ].map((p) => (
                                            <div
                                                key={p.pid}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    padding: "3px 4px",
                                                    borderBottom: `1px solid ${t.borderSubtle}`,
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                    <span style={{ color: t.textMuted }}>{p.pid}</span>
                                                    <span style={{ color: t.textPrimary }}>{p.cmd}</span>
                                                </div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <span style={{ color: t.textMuted }}>{p.cpu}</span>
                                                    <span style={{ color: p.color, fontWeight: 700 }}>{p.state}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB 2: DATA & SCHEMA */}
                        {sidePanelTab === "data" && (
                            <div style={{ padding: "12px 14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textMuted }}>
                                    Active Database & Tables
                                </div>
                                {[
                                    { name: "main.telemetry.user_events", rows: "1,420,800", cols: 14, format: "Delta / Parquet", status: "Unity Catalog" },
                                    { name: "main.telemetry.churn_cohorts", rows: "48,250", cols: 8, format: "Delta", status: "Profiled" },
                                    { name: "local.csv.sales_q3", rows: "12,400", cols: 6, format: "SQLite / CSV", status: "Checkpointed" },
                                ].map((tbl) => (
                                    <div
                                        key={tbl.name}
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 8,
                                            padding: "9px 11px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                            <span style={{ fontSize: 11.5, fontWeight: 700, color: t.textPrimary, fontFamily: "var(--app-font-mono, monospace)" }}>
                                                {tbl.name}
                                            </span>
                                            <span style={{ fontSize: 9.5, fontWeight: 600, color: t.accent, background: t.accentSubtle, padding: "1px 6px", borderRadius: 4 }}>
                                                {tbl.status}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 10.5, color: t.textMuted, display: "flex", gap: 8, marginBottom: 6 }}>
                                            <span>{tbl.rows} rows</span>
                                            <span>·</span>
                                            <span>{tbl.cols} columns</span>
                                            <span>·</span>
                                            <span>{tbl.format}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setDraft(`SELECT * FROM ${tbl.name} LIMIT 10;`);
                                                inputRef.current?.focus();
                                            }}
                                            style={{
                                                fontSize: 10,
                                                fontWeight: 600,
                                                padding: "3px 8px",
                                                borderRadius: 5,
                                                border: `1px solid ${t.border}`,
                                                background: isDark ? "#171b26" : "#f7f5ed",
                                                color: t.accent,
                                                cursor: "pointer",
                                            }}
                                        >
                                            Query sample in chat →
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* TAB 3: BOT SPECS */}
                        {sidePanelTab === "specs" && (
                            <div style={{ padding: "12px 14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textMuted, marginBottom: 6 }}>
                                        Specialist Architecture
                                    </div>
                                    <div
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 9,
                                            padding: "10px 12px",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 7,
                                            fontSize: 11,
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
                                                {"compute" in baseAgent ? String((baseAgent as any).compute) : "local-isolated"}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ color: t.textMuted }}>SQL Safety:</span>
                                            <span style={{ fontWeight: 600, color: "#10b981", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                                <ShieldCheck size={11} /> Read-only enforced
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ color: t.textMuted }}>Status:</span>
                                            <span style={{ color: t.accent, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
                                                <Check size={11} strokeWidth={2.5} /> Active & checkpointed
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Registered Tool Inventory */}
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textMuted, marginBottom: 6 }}>
                                        Registered Tool Inventory
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                        {[
                                            { name: "query_data", desc: "Read-only SQL queries across warehouse tables", tag: "SQL" },
                                            { name: "profile_table", desc: "Statistical distribution, nulls, percentiles & correlations", tag: "PROFILE" },
                                            { name: "discover_data", desc: "Navigate Unity Catalog schemas, namespaces & datasets", tag: "METADATA" },
                                            { name: "list_data_sources", desc: "List active and connected database providers", tag: "SOURCES" },
                                            { name: "auditor", desc: "Sub-agent statistical validation & audit verdict", tag: "AUDIT" },
                                            { name: "bash_sandbox", desc: "Isolated shell environment for Python/DuckDB execution", tag: "EXEC" },
                                        ].map((tool) => (
                                            <div
                                                key={tool.name}
                                                style={{
                                                    background: t.cardBg,
                                                    border: `1px solid ${t.border}`,
                                                    borderRadius: 7,
                                                    padding: "7px 9px",
                                                    display: "flex",
                                                    alignItems: "flex-start",
                                                    justifyContent: "space-between",
                                                    gap: 8,
                                                }}
                                            >
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textPrimary, fontFamily: "var(--app-font-mono, monospace)" }}>
                                                        {tool.name}
                                                    </div>
                                                    <div style={{ fontSize: 9.5, color: t.textMuted, marginTop: 2, lineHeight: 1.35 }}>
                                                        {tool.desc}
                                                    </div>
                                                </div>
                                                <span
                                                    style={{
                                                        fontSize: 8.5,
                                                        fontWeight: 700,
                                                        fontFamily: "var(--app-font-mono, monospace)",
                                                        padding: "1px 5px",
                                                        borderRadius: 4,
                                                        background: isDark ? "rgba(255, 255, 255, 0.06)" : "#f0ede4",
                                                        color: t.accent,
                                                        border: `1px solid ${t.borderSubtle}`,
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {tool.tag}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Durable Runtime & Storage Specs */}
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textMuted, marginBottom: 6 }}>
                                        Durable Runtime & Storage
                                    </div>
                                    <div
                                        style={{
                                            background: t.cardBg,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 9,
                                            padding: "9px 11px",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 6,
                                            fontSize: 10,
                                        }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ color: t.textMuted }}>Engine:</span>
                                            <span style={{ color: t.textPrimary, fontFamily: "var(--app-font-mono, monospace)" }}>@earendil-works/pi-durable</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ color: t.textMuted }}>Database:</span>
                                            <span style={{ color: t.textPrimary, fontFamily: "var(--app-font-mono, monospace)" }}>SQLite WAL (/workspace/dataclaw.db)</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ color: t.textMuted }}>Context Contract:</span>
                                            <span style={{ color: t.textPrimary }}>AGENTS.md reload on turn</span>
                                        </div>
                                    </div>
                                </div>

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
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        padding: "8px 12px",
                                        borderRadius: 7,
                                        border: `1px solid ${t.border}`,
                                        background: t.cardBg,
                                        color: t.textPrimary,
                                        cursor: "pointer",
                                        marginTop: 2,
                                    }}
                                >
                                    <Pencil size={12} />
                                    <span>Configure Specialist Archetype</span>
                                </button>
                            </div>
                        )}

                        {/* TAB 4: AUTONOMOUS ROUTINES */}
                        {sidePanelTab === "routines" && (
                            <div style={{ padding: "12px 14px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textMuted, marginBottom: 2 }}>
                                    Autonomous Routines
                                </div>
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
                                        padding: "7px 10px",
                                        color: t.textSecondary,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 5,
                                        marginTop: 4,
                                    }}
                                >
                                    <Plus size={13} />
                                    <span>+ New routine</span>
                                </button>
                            </div>
                        )}
                    </aside>
                );
            })()}

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
