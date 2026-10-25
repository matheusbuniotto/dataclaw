import React, { useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Database,
    ExternalLink,
    HelpCircle,
    Info,
    Scale,
    ShieldAlert,
    ShieldCheck,
    XCircle,
    Zap,
} from 'lucide-react';

export interface StatisticalApprovalPayload {
    kind: 'auditor_review' | 'ab_test_gate' | 'mutation_guard' | 'generic';
    title: string;
    target: string;
    risk: string;
    status: 'pending' | 'approved' | 'rejected' | 'indeterminate';
    // Auditor specific
    auditorVerdict?: 'confirmed' | 'rejected';
    sampleSize?: number;
    simpsonsParadoxRisk?: boolean;
    pHackingWarning?: string;
    // A/B test specific
    srmPassed?: boolean;
    srmPValue?: number;
    upliftEstimate?: string;
    wilsonInterval?: [number, number];
    fisherPValue?: number;
    recommendation?: 'ship' | 'hold' | 'retest';
    // Lakehouse specific
    query?: string;
    table?: string;
    isReadOnlyViolation?: boolean;
}

export function StatisticalApprovalCard({
    card,
    dark = true,
    connected = true,
    onDecide,
    onViewDetails,
}: {
    card: StatisticalApprovalPayload;
    dark?: boolean;
    connected?: boolean;
    onDecide: (decision: 'approve' | 'reject') => Promise<void>;
    onViewDetails?: () => void;
}) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const pending = card.status === 'pending';
    const isAuditor = card.kind === 'auditor_review';
    const isAbTest = card.kind === 'ab_test_gate';
    const isMutation = card.kind === 'mutation_guard';

    const run = async (op: () => Promise<void>) => {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            await op();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Action failed');
        } finally {
            setSaving(false);
        }
    };

    const statusBadge = () => {
        if (card.status === 'approved') {
            return (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <CheckCircle2 size={12} /> Approved
                </span>
            );
        }
        if (card.status === 'rejected') {
            return (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                    <XCircle size={12} /> Rejected
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 animate-pulse">
                <AlertTriangle size={12} /> Awaiting Review
            </span>
        );
    };

    return (
        <article
            className={`timeline-entry system w-full max-w-2xl rounded-2xl border p-4 sm:p-5 transition-all shadow-lg ${
                dark
                    ? 'bg-[#14161b] border-white/10 text-neutral-100 shadow-black/40'
                    : 'bg-white border-neutral-200 text-neutral-900 shadow-neutral-200/50'
            }`}
        >
            {/* Header pill strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                    <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1.5 ${
                            isAuditor
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : isAbTest
                                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                : isMutation
                                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                        }`}
                    >
                        {isAuditor && <Scale size={11} />}
                        {isAbTest && <Zap size={11} />}
                        {isMutation && <ShieldAlert size={11} />}
                        {isAuditor
                            ? 'Statistical Auditor'
                            : isAbTest
                            ? 'A/B Release Gate'
                            : isMutation
                            ? 'Lakehouse Safety'
                            : 'Action Request'}
                    </span>
                    <span className="text-xs text-neutral-400 font-mono truncate max-w-[200px]">
                        {card.target}
                    </span>
                </div>
                {statusBadge()}
            </div>

            {/* Title */}
            <h2 className="text-base font-semibold leading-tight break-words">{card.title}</h2>

            {/* Risk description tailored for data teams & business users */}
            <p className="text-xs text-neutral-400 mt-2 leading-relaxed">{card.risk}</p>

            {/* A/B Test Specific Metrics Visualization */}
            {isAbTest && (
                <div className="mt-4 p-3 rounded-xl bg-black/30 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-400">Sample Ratio Mismatch (SRM):</span>
                        <span
                            className={`font-semibold ${
                                card.srmPassed !== false ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                        >
                            {card.srmPassed !== false ? '✓ Passed (Fair 50/50 split)' : '✗ FAILED (Lopsided traffic)'}
                        </span>
                    </div>

                    {card.upliftEstimate && (
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-neutral-400">Estimated Uplift:</span>
                            <span className="font-semibold text-cyan-300">{card.upliftEstimate}</span>
                        </div>
                    )}

                    {card.wilsonInterval && (
                        <div className="space-y-1 pt-1">
                            <div className="flex justify-between text-[11px] text-neutral-400 font-mono">
                                <span>Wilson 95% CI</span>
                                <span>
                                    [{(card.wilsonInterval[0] * 100).toFixed(1)}%,{' '}
                                    {(card.wilsonInterval[1] * 100).toFixed(1)}%]
                                </span>
                            </div>
                            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden flex">
                                <div
                                    style={{
                                        marginLeft: `${Math.max(0, card.wilsonInterval[0] * 100)}%`,
                                        width: `${Math.max(
                                            5,
                                            (card.wilsonInterval[1] - card.wilsonInterval[0]) * 100,
                                        )}%`,
                                    }}
                                    className="h-full bg-cyan-400 rounded-full"
                                />
                            </div>
                        </div>
                    )}

                    {card.recommendation && (
                        <div className="pt-2 flex items-center justify-between border-t border-white/5 text-xs">
                            <span className="text-neutral-400 font-medium">Gate Recommendation:</span>
                            <span
                                className={`font-bold uppercase tracking-wider text-[11px] px-2 py-0.5 rounded ${
                                    card.recommendation === 'ship'
                                        ? 'bg-emerald-500/20 text-emerald-300'
                                        : 'bg-amber-500/20 text-amber-300'
                                }`}
                            >
                                {card.recommendation === 'ship' ? 'SHIP TO 100%' : 'HOLD / GATHER MORE DATA'}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Auditor Specific Caveat Visualization */}
            {isAuditor && (
                <div className="mt-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1.5 text-xs text-neutral-300">
                    {card.simpsonsParadoxRisk && (
                        <div className="flex items-start gap-2 text-amber-300">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
                            <span>
                                <strong>Simpson's Paradox detected:</strong> The trend reverses when broken down by user
                                tier. Review cohort distributions before presenting this conclusion.
                            </span>
                        </div>
                    )}
                    {card.sampleSize && card.sampleSize < 30 && (
                        <div className="flex items-center gap-2 text-amber-300/90 text-[11px]">
                            <Info size={13} className="shrink-0" />
                            <span>Small sample size warning ($N={card.sampleSize} &lt; 30$). High risk of noise.</span>
                        </div>
                    )}
                    {card.pHackingWarning && (
                        <div className="text-[11px] text-neutral-400">{card.pHackingWarning}</div>
                    )}
                </div>
            )}

            {/* Error alerts */}
            {error && <p className="mt-3 text-xs text-rose-400 bg-rose-500/10 p-2 rounded-lg">{error}</p>}

            {/* Action buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                {pending ? (
                    <>
                        <button
                            disabled={saving || !connected}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all disabled:opacity-40 flex items-center gap-1.5"
                            onClick={() => void run(() => onDecide('approve'))}
                        >
                            <CheckCircle2 size={13} />
                            {isAbTest ? 'Approve & Ship' : 'Confirm Finding'}
                        </button>
                        <button
                            disabled={saving || !connected}
                            className="rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-3.5 py-1.5 text-xs font-medium transition-all disabled:opacity-40 flex items-center gap-1.5"
                            onClick={() => void run(() => onDecide('reject'))}
                        >
                            <XCircle size={13} />
                            {isAbTest ? 'Reject / Hold' : 'Challenge Finding'}
                        </button>
                    </>
                ) : (
                    <span className="text-xs text-neutral-400 italic">Decision recorded in Pi Durable WAL</span>
                )}

                {onViewDetails && (
                    <button
                        disabled={saving}
                        className="ml-auto rounded-lg text-neutral-400 hover:text-white px-2.5 py-1.5 text-xs font-medium transition-all flex items-center gap-1"
                        onClick={onViewDetails}
                    >
                        <ExternalLink size={12} />
                        View Evidence & SQL
                    </button>
                )}
            </div>
        </article>
    );
}

export const ApprovalCard = StatisticalApprovalCard;
