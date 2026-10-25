import React, { useState } from 'react';
import { ArrowLeft, MoreHorizontal, Plus, Search, Users, X } from 'lucide-react';
import type { Bot, TeamFolder } from './types';
import { BotAvatar } from './BotAvatar';
import { useBotGrouping } from './useBotGrouping';

interface Props {
    disabled?: boolean;
    bots: Bot[];
    folders: TeamFolder[];
    theme: 'dark' | 'light';
    onSelectBot: (id: string) => void;
    onOpenNewBotModal: (folderId?: string) => void;
    onBackToChat: () => void;
    onEditBot?: (id: string) => void;
    onMoveBot: (id: string, folderId: string) => Promise<void>;
    onCreateFolder: (name: string, color: string) => Promise<void>;
}

export function TeamOrgView(props: Props) {
    const { bots, folders, theme } = props;
    const [search, setSearch] = useState('');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const grouping = useBotGrouping(
        bots,
        folders,
        props.onMoveBot,
        props.disabled,
        (id) =>
            setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            }),
    );

    const isDark = theme === 'dark';
    const button =
        'inline-flex items-center justify-center gap-1.5 rounded-xl border border-neutral-500/25 px-3.5 py-2 text-xs font-semibold hover:bg-white/5 disabled:opacity-40 transition-colors';
    const field = `w-full rounded-xl border border-white/10 px-3.5 py-2 text-sm outline-none ${
        isDark ? 'bg-[#14161b] text-white focus:border-cyan-500/40' : 'bg-white text-neutral-900 border-neutral-200'
    }`;
    const sections = [...folders, { id: '', name: 'Ungrouped Specialists', color: '#737373' }];
    const matching = bots.filter((bot) =>
        `${bot.name} ${bot.role} ${bot.department}`.toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <main
            {...grouping.zone}
            aria-label="Squad Organization"
            className={`flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-8 select-none ${
                isDark ? 'bg-[#090a0d] text-white' : 'bg-neutral-50 text-neutral-900'
            }`}
        >
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                        className={button}
                        onClick={props.onBackToChat}
                    >
                        <ArrowLeft size={14} />
                        Back to Investigation
                    </button>
                    <div className="flex gap-2">
                        <button
                            className={`${button} bg-cyan-600 hover:bg-cyan-500 text-white border-transparent`}
                            onClick={() => props.onOpenNewBotModal()}
                        >
                            <Plus size={14} />
                            New Specialist
                        </button>
                    </div>
                </div>

                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Analytics Squad Structure</h1>
                    <p className="text-sm text-neutral-400 mt-1">
                        Drag specialists between folders to organize data responsibilities. Changes commit dynamically to the workspace roster.
                    </p>
                </div>

                {/* Search */}
                <div>
                    <input
                        className={field}
                        placeholder="Search specialists by name, role, or data responsibility..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setCollapsed(new Set());
                        }}
                    />
                </div>

                {/* Notices */}
                {grouping.notice && (
                    <p className="text-xs text-cyan-400 bg-cyan-500/10 p-2.5 rounded-xl border border-cyan-500/20">
                        {grouping.notice}
                    </p>
                )}
                {grouping.error && (
                    <p className="text-xs text-rose-400 bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
                        {grouping.error}
                    </p>
                )}

                {/* Folders & Groups */}
                <div className="space-y-4">
                    {sections.map((group) => {
                        const members = matching.filter((bot) => (bot.folderId ?? '') === group.id);
                        if (search && members.length === 0 && !grouping.dragActive) return null;

                        return (
                            <section
                                key={group.id}
                                {...grouping.target(group.id)}
                                className={`rounded-2xl border transition-all ${
                                    grouping.targetId === group.id
                                        ? 'ring-2 ring-cyan-400 bg-cyan-500/10 border-cyan-400'
                                        : isDark
                                        ? 'bg-[#12141a] border-white/10'
                                        : 'bg-white border-neutral-200'
                                }`}
                            >
                                <header className="flex items-center justify-between p-4 border-b border-white/5">
                                    <div className="flex items-center gap-2">
                                        <Users size={15} className="text-cyan-400" />
                                        <h2 className="font-semibold text-sm">{group.name}</h2>
                                        <span className="text-xs text-neutral-500 font-mono">({members.length})</span>
                                    </div>
                                </header>

                                <div className="p-2 divide-y divide-white/5">
                                    {members.length === 0 ? (
                                        <p className="p-4 text-xs text-neutral-500 italic">
                                            No specialists assigned to this group. Drag one here.
                                        </p>
                                    ) : (
                                        members.map((bot) => (
                                            <div
                                                key={bot.id}
                                                {...grouping.source(bot)}
                                                onClick={() => props.onSelectBot(bot.id)}
                                                className="p-3 flex items-center justify-between gap-3 hover:bg-white/5 rounded-xl cursor-pointer transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <BotAvatar
                                                        shape={bot.shape}
                                                        color={bot.color}
                                                        size={36}
                                                        working={bot.status === 'executing'}
                                                    />
                                                    <div>
                                                        <span className="block font-semibold text-sm">{bot.name}</span>
                                                        <span className="block text-xs text-neutral-400">{bot.role}</span>
                                                        <span className="block text-[10px] text-neutral-500 mt-0.5">
                                                            Status: {bot.status}
                                                        </span>
                                                    </div>
                                                </div>

                                                <span className="text-xs text-neutral-500 font-mono">
                                                    Drag to move
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}
