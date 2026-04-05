export interface ActionItem {
  task: string;
  owner: string;
  deadline?: string;
  priority: "high" | "medium" | "low";
}

export interface ExtractedIntelligence {
  decisions: string[];
  blockers: string[];
  action_items: ActionItem[];
  open_questions: string[];
}

export interface PlannedAction {
  id: string;
  title: string;
  description: string;
  agent: "github_issue" | "email" | "meeting" | "term_sheet" | "slack";
  priority: "high" | "medium" | "low";
  data: Record<string, unknown>;
}

export interface PendingApproval {
  conversation_type: string;
  confidence: number;
  participants: string[];
  domain: string;
  execution_profile: string;
  extracted_intelligence: ExtractedIntelligence;
  action_plan: PlannedAction[];
  instructions: string;
}

export interface ExecutionResult {
  action_id: string;
  action_title: string;
  agent: string;
  result: string;
  timestamp: string;
}

export interface AuditEntry {
  step: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface Run {
  run_id: string;
  status: "pending_approval" | "running" | "completed";
  pending_approval?: PendingApproval;
  execution_results?: ExecutionResult[];
  audit_trail?: AuditEntry[];
}
