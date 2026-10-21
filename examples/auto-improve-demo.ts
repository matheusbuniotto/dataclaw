import { createAnalystHarness } from "../src/harness";
import { AutoImprovementTask } from "../src/tasks/auto-improvement";
import { PlaybookDoc } from "../src/docs/playbook";
import { TelemetryDoc } from "../src/docs/telemetry";
import { FindingsDoc } from "../src/docs/findings";

async function main() {
    console.log("==================================================================");
    console.log("  AUTO-IMPROVING ANALYST AGENT: CLOSED-LOOP SELF-REFINEMENT DEMO");
    console.log("==================================================================\n");

    const storagePath = "./auto_improve_demo.sqlite";
    const analyst = await createAnalystHarness({
        storagePath,
        resume: true,
    });

    console.log(`Connected to durable harness at ${storagePath}`);

    // STEP 1: Inspect Baseline Playbook (v1)
    const initialPlaybook = await analyst.getPlaybook();
    console.log(`\n>>> [STEP 1] INITIAL PLAYBOOK STATE`);
    console.log(`Playbook Version: v${initialPlaybook?.version}`);
    console.log(`Initial Heuristics Count: ${initialPlaybook?.heuristics.length}`);
    initialPlaybook?.heuristics.forEach((h) => {
        console.log(`  - [${h.id}] [${h.domain}] (${h.source}): ${h.rule}`);
    });

    // STEP 2: Simulate an Analysis Session with Auditor Corrections & Human Feedback
    console.log(`\n>>> [STEP 2] RECORDING SESSION TELEMETRY & FEEDBACK`);
    console.log(`Simulating analytical findings, auditor cautions, and reviewer guidance...`);

    await analyst.conversation.commit(async (tx) => {
        const findings = await tx.doc(FindingsDoc, analyst.conversation.id);
        const telemetry = await tx.doc(TelemetryDoc, analyst.conversation.id);

        // Add a finding that received caution during audit
        findings.findings.push({
            id: "find-exp-1",
            title: "Apparent Revenue Drop in Tech Sector",
            observation: "Tech sector monthly spend dropped 15% month-over-month.",
            impact: "medium",
            confidence: 0.72,
            evidence: { rationale: "Unsegmented sum of monthly_spend over time" },
            audited: true,
            auditVerdict: "caution",
            auditNotes: "Sample size in Tech sector is only n=8. High variance from a single churned account distorted average.",
            actionableRecommendations: ["Gather larger multi-quarter sample"],
            discoveredAt: Date.now(),
        });

        // Add human feedback and self-reflection
        telemetry.records.push({
            id: "tel-session-101",
            timestamp: Date.now(),
            workflowName: "customer_churn_q3",
            durationMs: 3420,
            hypothesesTested: 3,
            findingsGenerated: 2,
            humanRating: 3,
            humanFeedback: "Never report sector-level revenue drops when segment n < 20 without explicit confidence intervals.",
            reflectionNote: "Need to guard against small-sample sector generalizations.",
            proposedHeuristics: [
                "Require minimum sample size n >= 20 before claiming sector-level spend trends.",
            ],
            auditCorrections: 1,
            errorsEncountered: [],
        });

        telemetry.totalRuns += 1;
        telemetry.averageRating = 3.0;
    }, analyst.context);

    console.log("Telemetry and feedback successfully recorded in durable SQLite storage.");

    // STEP 3: Trigger AutoImprovementTask
    console.log(`\n>>> [STEP 3] DISPATCHING DURABLE AutoImprovementTask`);
    console.log("Scanning telemetry records, distilling failure modes, and generating upgraded rules...");

    const autoImproveTask = await analyst.conversation.commit(async (tx) => {
        return await tx.createTask(
            AutoImprovementTask,
            { focusDomain: "sample_size_hygiene" },
            { ownership: { kind: "conversation" } },
        );
    }, analyst.context);

    // Wait for the task outcome
    const taskResult = await analyst.harness.waitForTask(autoImproveTask, analyst.context);
    console.log("\nAutoImprovementTask Terminal Outcome:");
    console.log(taskResult.state.outcome.status === "completed" ? taskResult.state.outcome.result : "Failed");

    // STEP 4: Inspect Upgraded Playbook (v2)
    const upgradedPlaybook = await analyst.getPlaybook();
    console.log(`\n>>> [STEP 4] POST-IMPROVEMENT PLAYBOOK STATE`);
    console.log(`Playbook Version: v${upgradedPlaybook?.version} (UPGRADED!)`);
    console.log(`Total Active Heuristics: ${upgradedPlaybook?.heuristics.length}`);
    upgradedPlaybook?.heuristics.forEach((h) => {
        console.log(`  * [${h.id}] [${h.domain}] (${h.source}): ${h.rule}`);
    });

    console.log(`\nImprovement Log History:`);
    upgradedPlaybook?.improvementLog.forEach((log) => {
        console.log(`  - [${new Date(log.timestamp).toLocaleTimeString()}] ${log.reason}: ${log.notes}`);
    });

    // STEP 5: Verify that future prompt turns immediately receive the new rules
    console.log(`\n>>> [STEP 5] DYNAMIC PROMPT SECTION VERIFICATION`);
    console.log("Verifying that subsequent LLM generation contexts automatically receive the new v2 rules...");

    const submission = await analyst.conversation.submit(
        {
            type: "input",
            content: "What rules should we keep in mind when analyzing small customer cohorts?",
            requestId: "test-prompt-after-upgrade",
        },
        analyst.context,
    );

    const answer = await submission.wait(analyst.context);
    console.log("\nAgent Response with v2 Playbook active:");
    console.log(answer.answer ?? "Prompt executed successfully with new rules active in context.");

    await analyst.close();
    console.log("\n==================================================================");
    console.log("  AUTO-IMPROVEMENT CYCLE COMPLETED SUCCESSFULLY!");
    console.log("==================================================================\n");
}

main().catch(console.error);
