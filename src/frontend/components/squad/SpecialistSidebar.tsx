import React, { useState, type FC, type FormEvent } from 'react';
import type { Specialist, SquadFolder } from './types';
import { SpecialistAvatar } from './SpecialistAvatar';
import { SidebarContextMenu, type SidebarMenuTarget } from './SidebarContextMenu';
import { useSquadGrouping } from './useSquadGrouping';
import {
    Activity,
    Check,
    ChevronDown,
    ChevronRight,
    Database,
    FolderPlus,
    LayoutGrid,
    Moon,
    MoreVertical,
    Plus,
    Search,
    Sun,
    Users,
    X,
    Zap,
} from 'lucide-react';

export interface SpecialistSidebarProps {
    bots: Specialist[];
    folders: SquadFolder[];
    selectedBotId: string;
    onSelectBot: (botId: string) => void;
    onOpenNewBotModal: (folderId?: string) => void;
    onCreateFolder: (name: string, color?: string) => Promise<void>;
    onMoveBotToFolder: (botId: string, folderId: string) => Promise<void>;
    onOpenTeamOrg: () => void;
    activeView: 'chat' | 'team';
    theme: 'dark' | 'light';
    onToggleTheme?: () => void;
    mobileOpen?: boolean;
    onCloseMobile?: () => void;
    disabled?: boolean;
    databricksConnected?: boolean;
    onOpenDatabricksModal?: () => void;
}

export const SpecialistSidebar: FC<SpecialistSidebarProps> = ({
    bots,
    folders,
    selectedBotId,
    onSelectBot,
    onOpenNewBotModal,
    onCreateFolder,
    onMoveBotToFolder,
    onOpenTeamOrg,
    activeView,
    theme,
    onToggleTheme,
    mobileOpen = false,
    onCloseMobile,
    disabled = false,
    databricksConnected = false,
    onOpenDatabricksModal,
}) => {
    const [contextMenu, setContextMenu] = useState<SidebarMenuTarget | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [folderBusy, setFolderBusy] = useState(false);
    const [folderError, setFolderError] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [activeMenuBotId, setActiveMenuBotId] = useState<string | null>(null);

    const grouping = useSquadGrouping(
        bots,
        folders,
        onMoveBotToFolder,
        disabled,
        (id) => setCollapsedFolders((prev) => ({ ...prev, [id]: false })),
    );

    const toggleFolder = (folderId: string) => {
        setCollapsedFolders((prev) => ({
            ...prev,
            [folderId]: !prev[folderId],
        }));
    };

    const handleCreateFolderSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!newFolderName.trim() || folderBusy) return;
        setFolderBusy(true);
        setFolderError(null);
        try {
            await onCreateFolder(newFolderName.trim(), '#737373');
            setNewFolderName('');
            setIsCreatingFolder(false);
        } catch (failure) {
            setFolderError(failure instanceof Error ? failure.message : 'Could not create group.');
        } finally {
            setFolderBusy(false);
        }
    };

    const principalBot = bots.find((bot) => bot.pinned) ?? bots[0];

    const filteredBots = bots.filter(
        (b) =>
            b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.description.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const isDark = theme === 'dark';

    return (
        <aside
            aria-label="Specialist Roster"
            onContextMenu={(event) => {
                if (
                    !(event.target instanceof Element) ||
                    event.target.closest('input, textarea, select, [role="menu"]')
                )
                    return;
                event.preventDefault();
                const group = event.target.closest<HTMLElement>('[data-group-id]');
                setActiveMenuBotId(null);
                setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    folderId: group?.dataset.groupId,
                    folderName: group?.dataset.groupName,
                    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
                });
            }}
            className={`squad-sidebar w-72 md:w-80 shrink-0 h-full flex flex-col border-r transition-all select-none ${
                mobileOpen
                    ? 'motion-roster flex fixed inset-y-0 left-0 z-40 shadow-2xl'
                    : 'hidden md:flex'
            } ${
                isDark
                    ? 'bg-[#101217] border-white/5 text-neutral-200'
                    : 'bg-[#F9FAFB] border-neutral-200 text-neutral-800'
            }`}
        >
            {/* Header / Brand */}
            <div
                className={`pt-4 px-4 pb-3 flex items-center justify-between border-b ${
                    isDark ? 'border-white/5' : 'border-neutral-200'
                }`}
            >
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 grid place-items-center text-white shadow-sm font-bold text-xs">
                        🦀
                    </div>
                    <div>
                        <span className={`text-sm font-bold tracking-tight block ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            DataClaw
                        </span>
                        <span className="text-[10px] text-neutral-400 font-medium block -mt-0.5">
                            Analytics Intelligence
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {/* Databricks Status Pill */}
                    <button
                        onClick={onOpenDatabricksModal}
                        title={databricksConnected ? 'Databricks Unity Catalog Connected' : 'Connect to Databricks'}
                        className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold border transition-all ${
                            databricksConnected
                                ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20'
                                : 'bg-neutral-800/60 text-neutral-400 border-neutral-700 hover:text-white'
                        }`}
                    >
                        <span
                            className={`w-1.5 h-1.5 rounded-full ${
                                databricksConnected ? 'bg-cyan-400 animate-pulse' : 'bg-neutral-500'
                            }`}
                        />
                        <span>{databricksConnected ? 'Lakehouse' : 'Connect'}</span>
                    </button>

                    {/* Team Org View Button */}
                    <button
                        onClick={onOpenTeamOrg}
                        title="Squad Org View"
                        className={`p-1.5 rounded-lg transition-colors ${
                            activeView === 'team'
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : 'text-neutral-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <Users size={16} />
                    </button>

                    {mobileOpen && (
                        <button
                            aria-label="Close roster"
                            onClick={onCloseMobile}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-white md:hidden"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Principal Agent Feature Card */}
            {principalBot && (
                <section
                    aria-label="Lead Analyst"
                    className={`shrink-0 px-4 py-3.5 border-b ${
                        isDark ? 'border-white/5 bg-black/10' : 'border-neutral-200 bg-white'
                    }`}
                >
                    <button
                        {...grouping.source(principalBot)}
                        type="button"
                        aria-label={`Open principal agent ${principalBot.name}`}
                        onClick={() => onSelectBot(principalBot.id)}
                        className={`group w-full flex items-center gap-3.5 rounded-xl p-2.5 text-left transition-all ${
                            selectedBotId === principalBot.id && activeView === 'chat'
                                ? isDark
                                    ? 'bg-white/10 ring-1 ring-white/15'
                                    : 'bg-neutral-200/60'
                                : 'hover:bg-white/5'
                        }`}
                    >
                        <SpecialistAvatar
                            shape={principalBot.shape}
                            color={principalBot.color}
                            size={44}
                            working={principalBot.status === 'executing'}
                            entering={principalBot.justCreated}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <span
                                    className={`truncate text-sm font-semibold ${
                                        isDark ? 'text-white' : 'text-neutral-900'
                                    }`}
                                >
                                    {principalBot.name}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                    Lead
                                </span>
                            </div>
                            <span className="truncate text-xs text-neutral-400 block mt-0.5">
                                {principalBot.role}
                            </span>
                        </div>
                    </button>
                </section>
            )}

            {/* Search Input */}
            <div className="px-3 py-2.5">
                <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm transition-colors ${
                        isDark
                            ? 'bg-[#181a20] border-white/5 focus-within:border-cyan-500/40'
                            : 'bg-white border-neutral-200 focus-within:border-neutral-400'
                    }`}
                >
                    <Search size={14} className="text-neutral-500 shrink-0" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Search specialists"
                        placeholder="Search team or skill..."
                        className={`w-full bg-transparent text-xs outline-none placeholder:text-neutral-500 ${
                            isDark ? 'text-neutral-100' : 'text-neutral-900'
                        }`}
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="text-[10px] text-neutral-400 hover:text-neutral-200"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Folders and Bots Nav */}
            <nav
                tabIndex={0}
                aria-label="Specialist Roster"
                className="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-2.5"
            >
                {[...folders, { id: '', name: 'Specialists', color: '#737373' }].map((folder) => {
                    const folderBots = filteredBots.filter(
                        (b) =>
                            b.id !== principalBot?.id &&
                            ((b.folderId || b.department) === folder.id || (!folder.id && !b.folderId)),
                    );
                    if (folderBots.length === 0 && searchQuery) return null;
                    const isCollapsed = collapsedFolders[folder.id];

                    return (
                        <div
                            key={folder.id}
                            {...grouping.target(folder.id)}
                            data-group-id={folder.id}
                            data-group-name={folder.name}
                            className={`space-y-0.5 rounded-xl p-1 transition-colors ${
                                grouping.targetId === folder.id
                                    ? 'ring-2 ring-cyan-400/50 bg-cyan-500/10'
                                    : ''
                            }`}
                        >
                            {/* Folder Header */}
                            <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-neutral-400">
                                <button
                                    onClick={() => toggleFolder(folder.id)}
                                    className="flex items-center gap-1.5 hover:text-neutral-200 transition-colors"
                                >
                                    <span className="text-xs text-neutral-500">
                                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                    </span>
                                    <span className="uppercase tracking-wider">{folder.name}</span>
                                    <span className="text-[10px] text-neutral-500 font-normal">
                                        ({folderBots.length})
                                    </span>
                                </button>
                                <button
                                    onClick={() => onOpenNewBotModal(folder.id)}
                                    title="Add Specialist"
                                    className="text-neutral-500 hover:text-neutral-200 p-0.5 rounded"
                                >
                                    <Plus size={13} />
                                </button>
                            </div>

                            {/* Bots List */}
                            {!isCollapsed && (
                                <div className="space-y-1">
                                    {folderBots.map((bot) => {
                                        const isSelected = selectedBotId === bot.id && activeView === 'chat';
                                        return (
                                            <div
                                                key={bot.id}
                                                {...grouping.source(bot)}
                                                onClick={() => onSelectBot(bot.id)}
                                                className={`group flex items-center justify-between px-2.5 py-2 rounded-xl cursor-pointer transition-all ${
                                                    isSelected
                                                        ? isDark
                                                            ? 'bg-white/10 text-white font-medium shadow-sm'
                                                            : 'bg-neutral-200 text-neutral-900 font-medium'
                                                        : isDark
                                                        ? 'hover:bg-white/5 text-neutral-300'
                                                        : 'hover:bg-neutral-100 text-neutral-700'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <SpecialistAvatar
                                                        shape={bot.shape}
                                                        color={bot.color}
                                                        size={28}
                                                        working={bot.status === 'executing'}
                                                    />
                                                    <div className="min-w-0">
                                                        <span className="block text-xs font-semibold truncate leading-tight">
                                                            {bot.name}
                                                        </span>
                                                        <span className="block text-[10px] text-neutral-400 truncate leading-tight mt-0.5">
                                                            {bot.role}
                                                        </span>
                                                    </div>
                                                </div>

                                                {bot.status === 'executing' ? (
                                                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
                                                ) : bot.status === 'waiting_approval' ? (
                                                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Context Menu */}
            {contextMenu && (
                <SidebarContextMenu
                    target={contextMenu}
                    dark={isDark}
                    disabled={disabled}
                    close={() => setContextMenu(null)}
                    createGroup={() => setIsCreatingFolder(true)}
                    createBot={() => onOpenNewBotModal(contextMenu.folderId)}
                    manage={onOpenTeamOrg}
                />
            )}
        </aside>
    );
};

export const Sidebar = SpecialistSidebar;
