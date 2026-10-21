/**
 * The durable record, stored on `AnalystPlanDoc.dataSource`.
 *
 * This is the production `SourceRecordStore`: the session reads and writes through it, so the plan
 * document stays the one place a restart reconnects from.
 */
import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { SourceRecordStore } from "../datasource/session";
import type { SourceRecord } from "../datasource/types";
import { AnalystPlanDoc } from "./plan";

export function planSourceStore(
    harness: Harness,
    context: Context,
    conversationId: string | number,
): SourceRecordStore {
    const id = Number(conversationId) as ConversationId;

    const write = async (record: SourceRecord | undefined): Promise<void> => {
        const conversation = await harness.conversation(id, context);
        if (!conversation) return;
        await conversation.commit(async (tx) => {
            const plan = await tx.doc(AnalystPlanDoc, id);
            if (record) plan.dataSource = record;
            else delete plan.dataSource;
            plan.updatedAt = Date.now();
        }, context);
    };

    return {
        async read(): Promise<SourceRecord | undefined> {
            const state = await harness.documentState(AnalystPlanDoc, id, context);
            return state?.value?.dataSource;
        },
        write: (record: SourceRecord) => write(record),
        clear: () => write(undefined),
    };
}
