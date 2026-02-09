import { BaseAuditRule } from "../audit-rule";
import type { AuditContext, AuditDecision, AuditRuleConfig } from "../types";
import { isMcpTool } from "./rule-utils";

export class MCPToolAuditRule extends BaseAuditRule {
  constructor(config: AuditRuleConfig) {
    super(config);
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (context.event !== this.event) {
      return null;
    }
    const toolName = context.toolName;
    if (!toolName || !isMcpTool(toolName)) {
      return null;
    }
    if (!this.matcher.test(toolName)) {
      return null;
    }
    return this.createDecision(context, { toolName });
  }
}
