export type ScenarioFieldType = "text" | "textarea" | "date" | "select" | "email" | "id";
export type BackendSeverity = "warning" | "error";
export type TaskStatus = "awaiting_user" | "awaiting_backend" | "completed";
export type FeedbackStatus = "accepted" | "needs_attention" | "passed";

export interface ScenarioField {
  id: string;
  label: string;
  type: ScenarioFieldType;
  required: boolean;
  description: string;
  placeholder?: string;
  extractionHints: string[];
  options?: string[];
}

export interface KnowledgeReference {
  id: string;
  title: string;
  summary: string;
}

export interface BackendCheck {
  id: string;
  label: string;
  severity: BackendSeverity;
  description: string;
}

export interface Scenario {
  id: string;
  name: string;
  category: string;
  description: string;
  keywords: string[];
  schemaVersion: string;
  schema: ScenarioField[];
  knowledgeRefs: KnowledgeReference[];
  backendChecks: BackendCheck[];
  updatedAt: string;
}

export interface PlanningResult {
  confidence: number;
  matchedKeywords: string[];
  reasoning: string;
}

export interface RetrievalResult {
  schemaVersion: string;
  knowledgeRefs: string[];
  retrievedAt: string;
}

export interface ExtractionResult {
  schemaDraft: Record<string, string>;
  missingFields: string[];
  completionRate: number;
}

export interface FeedbackEntry {
  id: string;
  source: "user" | "backend";
  status: FeedbackStatus;
  message: string;
  createdAt: string;
}

export interface UserFeedbackInput {
  action: "revise" | "confirm";
  note?: string;
  draft?: Record<string, string>;
}

export interface LinkedContentRead {
  url: string;
  summary: string;
}

export interface LinkedContentFailure {
  url: string;
  reason: string;
}

export interface LinkedContentStatus {
  detectedUrls: string[];
  successfulReads: LinkedContentRead[];
  failedReads: LinkedContentFailure[];
}

export interface Task {
  id: string;
  request: string;
  scenarioId: string;
  scenarioName: string;
  status: TaskStatus;
  planning: PlanningResult;
  retrieval: RetrievalResult;
  extraction: ExtractionResult;
  userFeedback: FeedbackEntry[];
  backendFeedback: FeedbackEntry[];
  schemaFinal: Record<string, string>;
  linkedContent?: LinkedContentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSnapshot {
  scenarioCount: number;
  taskCount: number;
  completedTasks: number;
  attentionTasks: number;
  averageCompletion: number;
}
