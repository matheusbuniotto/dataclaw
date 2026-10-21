export interface Checkpoint {
    id: string;
    label: string;
    timestamp: string;
    summary: string;
    state: "done" | "current" | "queued";
}

export interface Run {
    id: string;
    agentId: string;
    goal: string;
    status: "Running" | "Completed" | "Failed";
    startedAt: string;
    duration: string;
    currentStep: string;
    checkpoints: Checkpoint[];
    dataSources: string[];
    event: string;
    error?: string;
}

export interface DataSource {
    id: string;
    name: string;
    type: string;
    status: "Healthy" | "Warning" | "Connected";
    freshness: string;
    records: string;
    agents: string[];
    runs: string[];
}

export interface RosterEntry {
    id: string;
    name: string;
    role: string;
    purpose: string;
    status: "active" | "archived";
    canManage: boolean;
    working: boolean;
}

export interface WorkspaceAgent {
    id: string;
    name: string;
    description: string;
    status: "Working" | "Ready";
    working: boolean;
    model: string;
    sources: string[];
}

export interface ToolInvocation {
    id: string;
    callId: string;
    toolName: string;
    summary: string;
    args?: Record<string, unknown> | unknown;
    status: "running" | "completed" | "error";
    resultText?: string;
    isError?: boolean;
    durationMs?: number;
    time?: string;
}

export interface TranscriptItem {
    id: string;
    role: "user" | "assistant" | "tool";
    text: string;
    toolName?: string;
    time: string;
    toolCallId?: string;
    toolArgs?: unknown;
    toolSummary?: string;
    toolStatus?: "running" | "completed" | "error";
    isError?: boolean;
    durationMs?: number;
    thinking?: string;
    tools?: ToolInvocation[];
}

export interface ActivityItem {
    kind: "ask" | "answer" | "tool" | "document";
    text: string;
    time: string;
}

export interface WorkspaceSkillInfo {
    name: string;
    description: string;
    location: string;
    source: "workspace" | "project" | "personal";
}

export interface WorkspaceHome {
    path: string;
    projectRoot: string;
    skills: WorkspaceSkillInfo[];
}

export interface WorkspacePlan {
    goal: string;
    status: string;
    milestone: string;
    hypothesisCount: number;
    dataset?: string;
}

export interface WorkspaceSnapshot {
    agent: WorkspaceAgent;
    plan: WorkspacePlan;
    findingsCount: number;
    playbookVersion: number;
    heuristicCount: number;
    roster: RosterEntry[];
    storagePath: string;
    home: WorkspaceHome;
    sources: DataSource[];
    runs: Run[];
    transcript: TranscriptItem[];
    activity: ActivityItem[];
}
