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

export type SpecialistShape = (typeof avatarShapes)[number] | 'bot' | 'spark' | 'search';
export type BotShape = SpecialistShape;

export interface SquadFolder {
    id: string;
    name: string;
    color?: string;
}
export type TeamFolder = SquadFolder;

export interface Specialist {
    configurationVersion: number;
    id: string;
    name: string;
    role: string;
    department: string;
    folderId?: string;
    shape: SpecialistShape;
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
    specialty?: 'lakehouse' | 'statistics' | 'orchestration' | 'sandbox' | 'custom';
    sampleQueries?: string[];
}
export type Bot = Specialist;
