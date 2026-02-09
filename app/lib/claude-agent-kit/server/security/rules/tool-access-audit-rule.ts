import { BaseAuditRule } from "../audit-rule";
import type { AuditContext, AuditDecision, AuditRuleConfig } from "../types";

export class ToolAccessAuditRule extends BaseAuditRule {
  private rateLimit?: AuditRuleConfig["rateLimit"];

  constructor(config: AuditRuleConfig) {
    super(config);
    this.rateLimit = config.rateLimit;
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (context.event !== this.event) {
      return null;
    }
    const toolName = context.toolName;
    if (!toolName || !this.matcher.test(toolName)) {
      return null;
    }

    if (this.rateLimit && context.toolUsage) {
      const { count, maxCalls, windowMs } = context.toolUsage;
      if (count > maxCalls) {
        return {
          ...this.createDecision(context, { count, maxCalls, windowMs }),
          action: "deny",
        };
      }
    }

    return this.createDecision(context, { toolName });
  }
}
