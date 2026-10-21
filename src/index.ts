export { createAnalystHarness } from "./harness";
export { MAIN_AGENT_NAME, MAIN_AGENT_DESCRIPTION, MAIN_AGENT_INSTRUCTIONS } from "./agent/instructions";
export {
    bindAgentWorkspace,
    currentWorkspace,
    ensureWorkspace,
    formatSkillsForPrompt,
    loadProjectContext,
    loadSkills,
    resolveWorkspaceDir,
    workspacePrompt,
} from "./workspace/context";
export type { CreateAnalystHarnessOptions } from "./harness";

// Documents
export { AnalystPlanDoc } from "./docs/plan";
export type { AnalystPlanDocument, Hypothesis, DatasetMeta } from "./docs/plan";

export { FindingsDoc } from "./docs/findings";
export type { FindingsDocument, Finding, FindingEvidence } from "./docs/findings";

export { PlaybookDoc } from "./docs/playbook";
export type { PlaybookDocument, PlaybookHeuristic, QueryPatternTemplate, AntiPatternRule } from "./docs/playbook";

export { TelemetryDoc } from "./docs/telemetry";
export type { TelemetryDocument, TelemetryRecord } from "./docs/telemetry";

export { AgentRosterDoc, AgentBindingDoc } from "./docs/agents";
export type { AgentRosterDocument, AgentBindingDocument, RosterAgent, AgentRun } from "./docs/agents";

// Extension
export { AnalystExtension } from "./extensions/analyst-extension";

// Tasks
export { AnalysisWorkflowTask } from "./tasks/analysis-workflow";
export type { AnalysisWorkflowInput, AnalysisWorkflowState } from "./tasks/analysis-workflow";

export { AutoImprovementTask } from "./tasks/auto-improvement";
export type { AutoImprovementInput, AutoImprovementState, CandidateRule } from "./tasks/auto-improvement";

// Tools
export {
    profileDatasetTool,
    runAnalyticalQueryTool,
    calculateStatisticalMetricTool,
    manageHypothesesTool,
    recordFindingTool,
    consultPlaybookTool,
} from "./tools/analyst-tools";

export {
    recordReflectionTool,
    recordHumanFeedbackTool,
    promotePlaybookRuleTool,
    triggerAutoImprovementTool,
} from "./tools/auto-improve-tools";

export {
    connectDatabricksTool,
    queryDatabricksTool,
    listDatabricksAssetsTool,
    profileDatabricksTableTool,
    getDatabricksAdapter,
    describeActiveDatabricks,
} from "./tools/databricks-tools";

export { requestAuditorReviewTool } from "./subagents/auditor-subagent";

export {
    agentsListTool,
    agentsCreateTool,
    agentsUpdateTool,
    agentsArchiveTool,
    spawnAgentTool,
    subagentsListTool,
} from "./tools/agent-tools";

// Adapters
export { SqliteDataAdapter } from "./adapters/sqlite-adapter";
export { DatabricksDataAdapter } from "./adapters/databricks-adapter";
export type { DatabricksAdapterOptions } from "./adapters/databricks-adapter";
export type { DataAdapter, DatasetProfile, ColumnProfile, QueryResult } from "./adapters/adapter-interface";

// Databricks MCP
export {
    resolveDatabricksConfig,
    describeDatabricksConfig,
    readDatabricksCfg,
    DatabricksConfigError,
} from "./mcp/databricks-config";
export type { DatabricksMcpConfig, DatabricksConfigOverrides } from "./mcp/databricks-config";
export {
    McpSqlClient,
    isReadOnlySql,
    assertReadOnlySql,
    normalizeStatementResult,
    decodeSqlValue,
} from "./mcp/mcp-sql-client";
export type { SqlExecutor, SqlExecutionResult, SqlColumn } from "./mcp/mcp-sql-client";

export {
    DatabricksOAuthSession,
    DatabricksOAuthError,
    buildAuthorizeUrl,
    generatePkcePair,
    exchangeAuthorizationCode,
    requestClientCredentialsToken,
    normalizeOAuthHost,
} from "./mcp/databricks-oauth";
export type { OAuthTokenSet } from "./mcp/databricks-oauth";

// Config
export { setupModelsRegistry, getDefaultModelRef } from "./config";
