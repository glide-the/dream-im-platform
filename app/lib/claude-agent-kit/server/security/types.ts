import { z } from "zod";

export const auditActionSchema = z.enum(["allow", "deny", "ask", "log"]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEventSchema = z.enum([
  "session_start",
  "pre_tool_use",
  "post_tool_use",
  "permission_request",
  "session_stop",
]);
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditRuleTypeSchema = z.enum([
  "network",
  "filesystem",
  "bash",
  "tool_access",
  "mcp_tool",
  "generic",
]);
export type AuditRuleType = z.infer<typeof auditRuleTypeSchema>;

export interface AuditContext {
  event: AuditEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  sessionId?: string;
  timestamp: string;
  cwd?: string;
  toolUseId?: string;
  toolUsage?: {
    count: number;
    maxCalls: number;
    windowMs: number;
  };
  metadata?: Record<string, unknown>;
}

export interface AuditDecision {
  action: AuditAction;
  reason?: string;
  ruleId?: string;
  updatedInput?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AuditLogEntry {
  timestamp: string;
  event: AuditEvent;
  toolName?: string;
  toolUseId?: string;
  sessionId?: string;
  action: AuditAction;
  reason?: string;
  ruleId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEvaluationResult {
  decision: AuditDecision;
  logs: AuditLogEntry[];
}

export interface AuditRuleConfig {
  id?: string;
  type: AuditRuleType;
  event: AuditEvent;
  matcher: string;
  action: AuditAction;
  reason?: string;
  allowedDomains?: string[];
  protectedPaths?: string[];
  excludedCommands?: string[];
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

export interface SecurityAuditConfig {
  rules: AuditRuleConfig[];
  sandbox?: {
    network?: {
      allowedDomains?: string[];
    };
    filesystem?: {
      protectedPaths?: string[];
    };
    excludedCommands?: string[];
  };
  hooks?: Partial<Record<AuditEvent, string[]>>;
  defaultAction?: AuditAction;
  configVersion?: string;
}

export interface AuditRule {
  id: string;
  type: AuditRuleType;
  event: AuditEvent;
  matcher: RegExp;
  action: AuditAction;
  reason?: string;
  evaluate(context: AuditContext): AuditDecision | null;
}
