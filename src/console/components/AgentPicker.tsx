import React from "react";
import type { RosterEntry } from "../state/workspace-types";

export function AgentPicker({
    roster,
    value,
    onChange,
    variant = "sidebar",
}: {
    roster: RosterEntry[];
    value: string;
    onChange: (id: string) => void;
    variant?: "sidebar" | "chat";
}) {
    const active = (roster ?? []).filter((entry) => entry.status === "active");

    return (
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", width: variant === "sidebar" ? "100%" : "auto" }}>
            <select
                className={`agent-picker ${variant === "chat" ? "agent-picker-chat" : ""}`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label="Active agent"
                title="Switch active specialist"
                style={{
                    appearance: "none",
                    WebkitAppearance: "none",
                    paddingRight: 26,
                    paddingLeft: 10,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                }}
            >
                <option value="dataclaw">DataClaw · Coordinator</option>
                {active.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                        {entry.name} · {entry.role} · {entry.compute}
                    </option>
                ))}
            </select>
            <div
                style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                    display: "flex",
                    alignItems: "center",
                    opacity: 0.55,
                }}
            >
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
            {variant === "sidebar" && active.length === 0 && (
                <div className="agent-picker-hint" style={{ marginTop: 4, fontSize: 10, opacity: 0.65 }}>
                    No specialists yet · ask DataClaw to create one
                </div>
            )}
        </div>
    );
}
