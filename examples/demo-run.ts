import { createAnalystHarness } from "../src/harness";
import { AnalysisWorkflowTask } from "../src/tasks/analysis-workflow";
import { generateMarkdownReport } from "../src/docs/report-generator";

async function main() {
    console.log("==================================================================");
    console.log("  DURABLE ANALYST AGENT - END-TO-END EXECUTION DEMO");
    console.log("==================================================================\n");

    const storagePath = "./demo_analyst.sqlite";
    const analyst = await createAnalystHarness({
        storagePath,
        resume: true,
    });

    console.log(`Harness initialized on SQLite storage: ${storagePath}`);
    console.log(`Configured Model: ${analyst.selectedModel.provider} / ${analyst.selectedModel.modelId}`);

    // 1. Submit an initial analysis goal using the durable task saga
    const targetData = "./sample-data/customer_churn.csv";
    const targetGoal = "Determine why B2B customer churn is increasing and identify primary risk indicators";

    console.log(`\nLaunching AnalysisWorkflowTask for dataset: ${targetData}`);
    console.log(`Analytical Goal: "${targetGoal}"\n`);

    const taskId = await analyst.conversation.commit(async (tx) => {
        return await tx.createTask(
            AnalysisWorkflowTask,
            { filePath: targetData, targetQuestion: targetGoal },
            { ownership: { kind: "conversation" } },
        );
    }, analyst.context);

    console.log("Awaiting workflow completion across durable checkpoints...");
    const outcome = await analyst.harness.waitForTask(taskId, analyst.context);
    console.log(`Workflow task finished with status: ${outcome.state.outcome.status}\n`);

    // Inspect the resulting durable documents
    const plan = await analyst.getPlan();
    const findings = await analyst.getFindings();
    const playbook = await analyst.getPlaybook();

    console.log("------------------------------------------------------------------");
    console.log("  DURABLE PLAN STATE (AnalystPlanDoc)");
    console.log("------------------------------------------------------------------");
    console.log(`Goal: ${plan?.goal}`);
    console.log(`Milestone: ${plan?.currentMilestone}`);
    console.log(`Active Hypotheses (${plan?.hypotheses.length ?? 0}):`);
    for (const h of plan?.hypotheses ?? []) {
        console.log(`  - [${h.id}] (${h.status}): ${h.title}`);
    }

    console.log("\n------------------------------------------------------------------");
    console.log("  VERIFIED FINDINGS (FindingsDoc)");
    console.log("------------------------------------------------------------------");
    console.log(`Total Findings: ${findings?.findings.length ?? 0}`);
    for (const f of findings?.findings ?? []) {
        console.log(`  * [${f.id}] ${f.title} (${f.impact.toUpperCase()} Impact, Conf: ${f.confidence})`);
        console.log(`    Audited: ${f.audited ? "YES (" + f.auditVerdict?.toUpperCase() + ")" : "NO (Pending Auditor)"}`);
        console.log(`    Observation: ${f.observation}`);
        console.log(`    Evidence Query: ${f.evidence.query}`);
        if (f.actionableRecommendations.length > 0) {
            console.log(`    Recommendations:`);
            for (const r of f.actionableRecommendations) {
                console.log(`      - ${r}`);
            }
        }
    }

    console.log("\n------------------------------------------------------------------");
    console.log("  ACTIVE PLAYBOOK (PlaybookDoc)");
    console.log("------------------------------------------------------------------");
    console.log(`Playbook Version: v${playbook?.version}`);
    console.log(`Active Heuristics (${playbook?.heuristics.length ?? 0}):`);
    for (const h of playbook?.heuristics ?? []) {
        console.log(`  - [${h.domain}] (${h.source}): ${h.rule}`);
    }

    await analyst.close();
    console.log("\nDemo run finished successfully. Harness closed.\n");
}

main().catch(console.error);
