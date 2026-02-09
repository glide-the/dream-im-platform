import type { AuditContext, AuditDecision, AuditRule, AuditRuleConfig } from "./types";

export abstract class BaseAuditRule implements AuditRule {
  readonly id: string;
  readonly type: AuditRule["type"];
  readonly event: AuditRule["event"];
  readonly matcher: RegExp;
  readonly action: AuditRule["action"];
  readonly reason?: string;

  constructor(config: AuditRuleConfig) {
    this.id = config.id ?? `${config.type}:${config.event}:${config.matcher}:${config.action}`;
    this.type = config.type;
    this.event = config.event;
    this.matcher = new RegExp(config.matcher);
    this.action = config.action;
    this.reason = config.reason;
  }

  protected createDecision(context: AuditContext, metadata?: Record<string, unknown>): AuditDecision {
    return {
      action: this.action,
      reason: this.reason,
      ruleId: this.id,
      metadata,
    };
  }

  abstract evaluate(context: AuditContext): AuditDecision | null;
}
