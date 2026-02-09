import { BaseAuditRule } from "../audit-rule";
import type { AuditContext, AuditDecision, AuditRuleConfig } from "../types";

export class GenericAuditRule extends BaseAuditRule {
  constructor(config: AuditRuleConfig) {
    super(config);
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (context.event !== this.event) {
      return null;
    }
    const target = context.toolName ?? "";
    if (!this.matcher.test(target)) {
      return null;
    }
    return this.createDecision(context, { target });
  }
}
