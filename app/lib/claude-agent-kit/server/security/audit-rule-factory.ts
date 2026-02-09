import type { AuditRule, AuditRuleConfig } from "./types";
import { BashCommandAuditRule } from "./rules/bash-command-audit-rule";
import { FileSystemAuditRule } from "./rules/filesystem-audit-rule";
import { GenericAuditRule } from "./rules/generic-audit-rule";
import { MCPToolAuditRule } from "./rules/mcp-tool-audit-rule";
import { NetworkAuditRule } from "./rules/network-audit-rule";
import { ToolAccessAuditRule } from "./rules/tool-access-audit-rule";

export class AuditRuleFactory {
  private rulePool = new Map<string, AuditRule>();

  getOrCreateRule(config: AuditRuleConfig): AuditRule {
    const ruleKey = this.createRuleKey(config);
    const cached = this.rulePool.get(ruleKey);
    if (cached) {
      return cached;
    }

    const rule = this.instantiateRule(config);
    this.rulePool.set(ruleKey, rule);
    return rule;
  }

  updateRules(configs: AuditRuleConfig[]): AuditRule[] {
    const nextRulePool = new Map<string, AuditRule>();
    const rules: AuditRule[] = [];

    for (const config of configs) {
      const ruleKey = this.createRuleKey(config);
      const cached = this.rulePool.get(ruleKey);
      const rule = cached ?? this.instantiateRule(config);
      nextRulePool.set(ruleKey, rule);
      rules.push(rule);
    }

    this.rulePool = nextRulePool;
    return rules;
  }

  private createRuleKey(config: AuditRuleConfig): string {
    return [
      config.id,
      config.type,
      config.event,
      config.matcher,
      config.action,
      config.reason,
      config.allowedDomains?.join(","),
      config.protectedPaths?.join(","),
      config.excludedCommands?.join(","),
      config.rateLimit ? `${config.rateLimit.maxCalls}:${config.rateLimit.windowMs}` : undefined,
    ]
      .filter(Boolean)
      .join("|");
  }

  private instantiateRule(config: AuditRuleConfig): AuditRule {
    switch (config.type) {
      case "network":
        return new NetworkAuditRule(config);
      case "filesystem":
        return new FileSystemAuditRule(config);
      case "bash":
        return new BashCommandAuditRule(config);
      case "tool_access":
        return new ToolAccessAuditRule(config);
      case "mcp_tool":
        return new MCPToolAuditRule(config);
      case "generic":
      default:
        return new GenericAuditRule(config);
    }
  }
}
