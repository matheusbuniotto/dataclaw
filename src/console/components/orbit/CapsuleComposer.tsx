import React, { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
    AlertTriangle,
    ArrowUp,
    AtSign,
    CornerDownLeft,
    Database,
    Pause,
    Scale,
    Sparkles,
    Square,
    Zap,
} from 'lucide-react';
import type { Bot } from '../grok/types';

interface CapsuleComposerProps {
    onSend: (content: string, specialistId?: string) => Promise<void>;
    onAbort?: () => Promise<void>;
    working?: boolean;
    bots: Bot[];
    dark?: boolean;
}

const STARTER_PROMPTS = [
    {
        label: 'A/B Test Gate',
        icon: Scale,
        prompt: 'Run an A/B test release gate comparing Variant A vs Variant B. Check SRM, Wilson 95% interval, and Fisher exact p-value before recommending ship.',
    },
    {
        label: 'Churn Cohort Analysis',
        icon: Database,
        prompt: 'Analyze customer churn drivers across tier cohorts in customer_churn.csv. Check if churn rate differs by tenure or spend.',
    },
    {
        label: 'Statistical Audit',
        icon: AlertTriangle,
        prompt: 'Audit current findings for Simpson’s Paradox, p-hacking, and small-sample noise (N < 30).',
    },
    {
        label: 'Databricks Unity Catalog',
        icon: Zap,
        prompt: 'Inspect connected Unity Catalog tables, verify schema column types, and profile row counts.',
    },
];

export function CapsuleComposer({
    onSend,
    onAbort,
    working = false,
    bots,
    dark = true,
}: CapsuleComposerProps) {
    const [input, setInput] = useState('');
    const [mode, setMode] = useState<'steer' | 'queue'>('steer');
    const [mentionOpen, setMentionOpen] = useState(false);
    const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
    const [targetedBotId, setTargetedBotId] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (mentionOpen) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedMentionIndex((prev) => (prev + 1) % bots.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedMentionIndex((prev) => (prev - 1 + bots.length) % bots.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const picked = bots[selectedMentionIndex];
                if (picked) {
                    insertMention(picked);
                }
                return;
            }
            if (e.key === 'Escape') {
                setMentionOpen(false);
                return;
            }
        }

        if (e.key === '@') {
            setMentionOpen(true);
            setSelectedMentionIndex(0);
        }

        // Steer on Enter without shift, or queue on Shift+Enter if selected
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
        }
    };

    const insertMention = (bot: Bot) => {
        setTargetedBotId(bot.id);
        setMentionOpen(false);
        // Replace or prepend
        const current = input.trim();
        if (current.startsWith('@')) {
            const parts = current.split(' ');
            parts[0] = `@${bot.name}`;
            setInput(parts.join(' ') + ' ');
        } else {
            setInput(`@${bot.name} ${current}`);
        }
        textareaRef.current?.focus();
    };

    const submit = async () => {
        const text = input.trim();
        if (!text || working) return;
        setInput('');
        await onSend(text, targetedBotId ?? undefined);
        setTargetedBotId(null);
    };

    const targetedBot = bots.find((b) => b.id === targetedBotId);

    return (
        <div className="w-full max-w-4xl mx-auto px-4 pb-4">
            {/* Quick Action Chips */}
            <div className="flex items-center gap-2 mb-2.5 overflow-x-auto pb-1 select-none scrollbar-none">
                {STARTER_PROMPTS.map((starter) => {
                    const Icon = starter.icon;
                    return (
                        <button
                            key={starter.label}
                            onClick={() => {
                                setInput(starter.prompt);
                                textareaRef.current?.focus();
                            }}
                            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                dark
                                    ? 'bg-[#181a20] border-white/10 text-neutral-300 hover:text-white hover:border-cyan-500/40 hover:bg-white/5'
                                    : 'bg-white border-neutral-200 text-neutral-700 hover:text-neutral-900 hover:border-neutral-300'
                            }`}
                        >
                            <Icon size={12} className="text-cyan-400" />
                            <span>{starter.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Mention Menu */}
            {mentionOpen && (
                <div
                    className={`absolute bottom-24 z-50 w-72 rounded-xl border p-1 shadow-2xl backdrop-blur-md ${
                        dark
                            ? 'bg-[#181a20]/95 border-white/10 text-neutral-200'
                            : 'bg-white/95 border-neutral-200 text-neutral-800'
                    }`}
                >
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                        Target Specialist
                    </div>
                    <div className="space-y-0.5">
                        {bots.map((bot, idx) => (
                            <button
                                key={bot.id}
                                onClick={() => insertMention(bot)}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                                    idx === selectedMentionIndex
                                        ? 'bg-cyan-500/20 text-cyan-300'
                                        : 'hover:bg-white/5'
                                Could }`}
                            >
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: bot.color }} />
                                <span className="font-semibold truncate">{bot.name}</span>
                                <span className="text-[10px] text-neutral-400 truncate ml-auto">{bot.role}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Floating Capsule */}
            <div
                className={`relative rounded-2xl border transition-all shadow-xl ${
                    dark
                        ? 'bg-[#14161b] border-white/10 shadow-black/50 focus-within:border-cyan-500/40 focus-within:ring-2 focus-within:ring-cyan-500/10'
                        : 'bg-white border-neutral-200 shadow-neutral-200/50 focus-within:border-neutral-400'
                }`}
            >
                {/* Active Targeted Specialist Badge */}
                {targetedBot && (
                    <div className="flex items-center gap-1.5 px-3.5 pt-2 text-[11px] text-cyan-300">
                        <AtSign size={12} />
                        <span className="font-semibold">Targeted to:</span>
                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 font-mono text-[10px]">
                            {targetedBot.name}
                        </span>
                        <button
                            onClick={() => setTargetedBotId(null)}
                            className="ml-1 text-neutral-400 hover:text-white"
                        >
                            ×
                        </button>
                    </div>
                )}

                <textarea
                    ref={textareaRef}
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask an analytical question, run SQL, or test hypotheses... (@ to tag specialist)"
                    className={`w-full px-4 pt-3 pb-2 bg-transparent text-sm outline-none resize-none placeholder:text-neutral-500 ${
                        dark ? 'text-neutral-100' : 'text-neutral-900'
                    }`}
                />

                <div className="flex items-center justify-between px-3.5 pb-2.5 pt-1">
                    {/* Mode & Helpers */}
                    <div className="flex items-center gap-2 text-xs">
                        <button
                            onClick={() => setMode((prev) => (prev === 'steer' ? 'queue' : 'steer'))}
                            title="Steer active task immediately or queue for next turn"
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border transition-colors ${
                                mode === 'steer'
                                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                    : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                            }`}
                        >
                            {mode === 'steer' ? 'Steer (Enter)' : 'Queue (Shift+Enter)'}
                        </button>
                        <span className="text-[11px] text-neutral-500 hidden sm:inline">
                            Checkpointed to Pi Durable SQLite WAL
                        </span>
                    </div>

                    {/* Send / Stop Buttons */}
                    <div className="flex items-center gap-2">
                        {working && onAbort && (
                            <button
                                onClick={onAbort}
                                className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                            >
                                <Square size={12} className="fill-current" />
                                Stop
                            </button>
                        )}

                        <button
                            disabled={!input.trim() || working}
                            onClick={submit}
                            className={`p-2 rounded-xl transition-all flex items-center justify-center ${
                                input.trim() && !working
                                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20 hover:scale-105 active:scale-95'
                                    : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                            }`}
                        >
                            <ArrowUp size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
