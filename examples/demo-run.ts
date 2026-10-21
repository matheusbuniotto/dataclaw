import { createAnalystHarness } from "../src/harness";
import { AnalysisWorkflowTask } from "../src/tasks/analysis-workflow";

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

    const submission = await analyst.conversation.submit(
        {
            type: "input",
            content: `Please execute an in-depth analysis on ${targetData} to ${targetGoal}. Profile the schema, test hypotheses, and synthesize executive findings.`,
            requestId: "workflow-run-001",
        },
        analyst.context,
    );

    // Also run the background durable task to guarantee end-to-end execution
    const taskId = await analyst.conversation.submit(
        {
            type: "input",
            content: "Run full analytical pipeline",
            requestId: "task-dispatch-001",
        },
        analyst.context,
    );

    // Run the AnalysisWorkflowTask directly on the harness storage
    const txTask = await analyst.harness.root(analyst.context);
    console.log("Awaiting workflow completion across durable checkpoints...");

    // We can also trigger the durable workflow task directly
    const workflowId = await analyst.conversation.submit(
        {
            type: "input",
            content: "Consulting playbook and executing hypothesis testing.",
            requestId: "wf-exec-001",
        },
        analyst.context,
    );

    // Wait for submission
    const res = await submission.wait(analyst.context);
    console.log("\nSubmission settled successfully!");

    // Inspect the resulting durable documents
    const plan = await analyst.getPlan();
    const findings = await analyst.getFindings();
    const playbook = await analyst.getPlaybook();

    console.log("\n------------------------------------------------------------------");
    console.log("  DURABLE PLAN STATE (AnalystPlanDoc)");
    console.log("------------------------------------------------------------------");
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
        console.log(`    Audited: ${f.audited ? "YES (" + f.auditVerdict?.toUpperCase() + ")" : "NO"}`);
        console.log(`    Observation: ${f.observation}`);
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
