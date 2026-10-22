// View-model helpers the pages share: look up a displayed agent, turn a status into its pill
// class, and map a durable roster entry onto the `WorkspaceAgent` shape a page renders.
import type { RosterEntry, WorkspaceAgent } from "../state/workspace-types";

export const agentById = (id: string, agents: WorkspaceAgent[]) => agents.find((agent) => agent.id === id);
export const statusClass = (s: string) => `status-pill status-${s.toLowerCase()}`;

export const agentInitials = (name: string) => name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "DC";

export function rosterAsAgents(roster: RosterEntry[] | undefined, model: string): WorkspaceAgent[] {
    return (roster ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.purpose,
        status: entry.working ? "Working" : "Ready",
        working: entry.working,
        model: entry.model ?? model,
        sources: [
            entry.status === "archived" ? `${entry.role} · archived` : entry.role,
            `compute: ${entry.compute}`,
        ],
    }));
}
