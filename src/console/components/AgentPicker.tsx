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
        <>
            <select
                className={`agent-picker ${variant === "chat" ? "agent-picker-chat" : ""}`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label="Active agent"
                title="Switch agent"
            >
                <option value="dataclaw">DataClaw · coordinator</option>
                {active.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                        {entry.name} · {entry.role} · {entry.compute}
                    </option>
                ))}
            </select>
            {variant === "sidebar" && active.length === 0 && (
                <div className="agent-picker-hint">No specialists yet · ask DataClaw to create one</div>
            )}
        </>
    );
}
