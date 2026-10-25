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

// Domain Brands & Type Guards
export {
    isAgentId,
    isFindingId,
    isHypothesisId,
    isRuleId,
    isProviderId,
    isTableName,
    isMetricName,
    parseAgentId,
    parseFindingId,
    parseHypothesisId,
    parseRuleId,
} from "./types/brands";
export type {
    Brand,
    AgentId,
    FindingId,
    HypothesisId,
    RuleId,
    ProviderId,
    TableName,
    MetricName,
} from "./types/brands";

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
export { createAnalystTools } from "./extensions/analyst-extension";

// Tasks
export { AnalysisWorkflowTask } from "./tasks/analysis-workflow";
export type { AnalysisWorkflowInput, AnalysisWorkflowState } from "./tasks/analysis-workflow";

export { AutoImprovementTask } from "./tasks/auto-improvement";
export type { AutoImprovementInput, AutoImprovementState, CandidateRule } from "./tasks/auto-improvement";

// Tools
export { manageHypothesesTool, recordFindingTool, consultPlaybookTool } from "./tools/analyst-tools";
export { createDataSourceTools } from "./tools/datasource-tools";

export {
    recordReflectionTool,
    recordHumanFeedbackTool,
    promotePlaybookRuleTool,
    triggerAutoImprovementTool,
} from "./tools/auto-improve-tools";

export { createAuditorReviewTool } from "./subagents/auditor-subagent";

// Data sources
export { DataSourceCatalog } from "./datasource/catalog";
export { DataSourceRegistry } from "./datasource/session";
export type { ProviderCatalog, ProviderDescriptor, SourceRecordStore } from "./datasource/session";

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
export {
    setupModelsRegistry,
    getDefaultModelRef,
    resolveCustomModelConfig,
    createCustomModelProvider,
    resolveDatabricksModelConfig,
    createDatabricksModelProvider,
    isCustomModelConfigured,
    isDatabricksModelConfigured,
    normalizeBaseUrl,
    DATABRICKS_FOUNDATION_MODELS,
} from "./config";
export type {
    CustomModelConfig,
    DatabricksModelConfig,
    ResolvedModelConfig,
    ModelRegistryOptions,
} from "./config";
