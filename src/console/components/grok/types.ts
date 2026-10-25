export const avatarShapes = [
    'droplet',
    'round',
    'squircle',
    'pebble',
    'triangle',
    'hexagon',
    'cloud',
    'tear',
] as const;

export type BotShape = (typeof avatarShapes)[number] | 'bot' | 'spark' | 'search';

export interface TeamFolder {
    id: string;
    name: string;
    color?: string;
}

export interface Bot {
    configurationVersion: number;
    id: string;
    name: string;
    role: string;
    department: string;
    folderId?: string;
    shape: BotShape;
    color: string;
    description: string;
    systemPrompt: string;
    status: 'unknown' | 'idle' | 'executing' | 'waiting_approval' | 'waiting_delegation' | 'error';
    lastMessagePreview?: string;
    lastActiveTime?: string;
    plugins: string[];
    unreadCount?: number;
    pinned?: boolean;
    justCreated?: boolean;
    // Data-specific badges
    specialty?: 'lakehouse' | 'statistics' | 'orchestration' | 'sandbox' | 'custom';
    sampleQueries?: string[];
}
