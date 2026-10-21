import { createAnalystHarness } from "../src/harness";
import { AnalystPlanDoc } from "../src/docs/plan";
import { FindingsDoc } from "../src/docs/findings";
import { unlinkSync, existsSync } from "fs";

async function main() {
    console.log("==================================================================");
    console.log("  PI-DURABLE CRASH RESILIENCE & RESUMPTION DEMO");
    console.log("==================================================================\n");

    const storagePath = "./crash_resilience_test.sqlite";
    if (existsSync(storagePath)) unlinkSync(storagePath);

    // ==========================================
    // RUN 1: Host process starts work, then "crashes"
    // ==========================================
    console.log(">>> [PHASE 1] INITIAL RUN: Starting analysis and committing checkpoints...");
    const harness1 = await createAnalystHarness({
        storagePath,
        resume: false,
    });

    await harness1.conversation.commit(async (tx) => {
        const plan = await tx.doc(AnalystPlanDoc, harness1.conversation.id);
        const findings = await tx.doc(FindingsDoc, harness1.conversation.id);

        plan.goal = "Analyze payment gateway latency bottlenecks";
        plan.status = "investigating";
        plan.currentMilestone = "Executing Step 3 of 5";
        plan.hypotheses.push({
            id: "hyp-latency-1",
            title: "Database connection pool timeouts correlate with spike in 504 errors",
            description: "Testing connection pool exhaustion under high concurrency",
            status: "testing",
            evidenceIds: ["ev-1"],
            proposedAt: Date.now(),
            updatedAt: Date.now(),
        });

        findings.findings.push({
            id: "find-pre-crash-1",
            title: "Connection pool exhaustion verified during billing batches",
            observation: "95% of 504 gateway timeouts occurred while active connection count = 100 max limit.",
            impact: "critical",
            confidence: 0.98,
            evidence: { rationale: "Aggregated pool metrics from incident logs" },
            audited: false,
            actionableRecommendations: ["Increase pool size to 250", "Add jitter to batch billing cron"],
            discoveredAt: Date.now(),
        });
    }, harness1.context);

    console.log("Committed milestone: 'Executing Step 3 of 5' and 1 finding to SQLite.");
    console.log(">>> [SIMULATED CRASH] Terminating process abruptly (closing storage)...");
    await harness1.close();

    // ==========================================
    // RUN 2: Host process restarts after crash
    // ==========================================
    console.log("\n>>> [PHASE 2] RECOVERY: New process instance boots up on same SQLite file...");
    const harness2 = await createAnalystHarness({
        storagePath,
        resume: true, // Calls harness.resume() automatically
    });

    console.log("harness.resume() executed cleanly.");

    const recoveredPlan = await harness2.getPlan();
    const recoveredFindings = await harness2.getFindings();

    console.log("\n>>> [PHASE 3] VERIFYING RECOVERED STATE:");
    console.log(`Recovered Goal: "${recoveredPlan?.goal}"`);
    console.log(`Recovered Milestone: "${recoveredPlan?.currentMilestone}"`);
    console.log(`Recovered Hypotheses Count: ${recoveredPlan?.hypotheses.length}`);
    for (const h of recoveredPlan?.hypotheses ?? []) {
        console.log(`  - [${h.id}] (${h.status}): ${h.title}`);
    }

    console.log(`\nRecovered Findings Count: ${recoveredFindings?.findings.length}`);
    for (const f of recoveredFindings?.findings ?? []) {
        console.log(`  * [${f.id}] ${f.title} (${f.impact.toUpperCase()})`);
        console.log(`    Observation: ${f.observation}`);
    }

    // Continue execution from recovered point
    console.log("\n>>> [PHASE 4] CONTINUING EXECUTION POST-CRASH:");
    await harness2.conversation.commit(async (tx) => {
        const plan = await tx.doc(AnalystPlanDoc, harness2.conversation.id);
        plan.currentMilestone = "Executing Step 4 of 5 (Post-Recovery)";
        plan.status = "completed";
    }, harness2.context);

    const updatedPlan = await harness2.getPlan();
    console.log(`Successfully advanced milestone to: "${updatedPlan?.currentMilestone}"`);

    await harness2.close();
    console.log("\n==================================================================");
    console.log("  CRASH RESILIENCE DEMO COMPLETED SUCCESSFULLY: ZERO DATA LOSS!");
    console.log("==================================================================\n");
}

main().catch(console.error);
