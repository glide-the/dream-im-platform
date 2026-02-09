import { BaseAuditRule } from "../audit-rule";
import type { AuditContext, AuditDecision, AuditRuleConfig } from "../types";
import { pickString } from "./rule-utils";

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bcurl\b[^|]*\|\s*sh/i,
  /\bsudo\b/i,
];

export class BashCommandAuditRule extends BaseAuditRule {
  private excludedCommands?: string[];

  constructor(config: AuditRuleConfig) {
    super(config);
    this.excludedCommands = config.excludedCommands;
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (context.event !== this.event) {
      return null;
    }
    const toolName = context.toolName;
    if (!toolName || !this.matcher.test(toolName)) {
      return null;
    }

    const command = pickString(context.toolInput, ["command", "cmd"]);
    if (!command) {
      return null;
    }

    if (this.excludedCommands && this.excludedCommands.some((entry) => command.includes(entry))) {
      return {
        ...this.createDecision(context, { command, excludedCommands: this.excludedCommands }),
        action: "deny",
      };
    }

    const matchedPattern = DANGEROUS_PATTERNS.find((pattern) => pattern.test(command));
    if (matchedPattern) {
      return {
        ...this.createDecision(context, { command, pattern: matchedPattern.source }),
        action: this.action === "allow" ? "ask" : this.action,
      };
    }

    return this.createDecision(context, { command });
  }
}
