import { normalizeSecurityAuditConfig } from "./config-schema";
import { AuditRuleFactory } from "./audit-rule-factory";
import type {
  AuditDecision,
  AuditEvaluationResult,
  AuditLogEntry,
  AuditRule,
  AuditRuleConfig,
  AuditEvent,
  SecurityAuditConfig,
  AuditContext,
} from "./types";

const ACTION_PRIORITY: Record<AuditDecision["action"], number> = {
  deny: 3,
  ask: 2,
  allow: 1,
  log: 0,
};

interface RuleUsageTracker {
  timestamps: number[];
  config: AuditRuleConfig["rateLimit"];
}

export class SecurityAuditEngine {
  private config: SecurityAuditConfig;
  private factory: AuditRuleFactory;
  private rulesByEvent: Map<AuditEvent, AuditRule[]> = new Map();
  private usageCounters: Map<string, RuleUsageTracker> = new Map();

  constructor(config: SecurityAuditConfig) {
    this.factory = new AuditRuleFactory();
    this.config = normalizeSecurityAuditConfig(config);
    this.rebuildRules();
  }

  updateConfig(config: SecurityAuditConfig): void {
    this.config = normalizeSecurityAuditConfig(config);
    this.rebuildRules();
  }

  evaluate(context: AuditContext): AuditEvaluationResult {
    const rules = this.rulesByEvent.get(context.event) ?? [];
    const decisions: AuditDecision[] = [];
    const logs: AuditLogEntry[] = [];

    for (const rule of rules) {
      const contextWithUsage = this.attachUsage(rule, context);
      const decision = rule.evaluate(contextWithUsage);
      if (!decision) {
        continue;
      }
      decisions.push(decision);
      logs.push(this.buildLogEntry(context, decision));
      if (decision.action === "deny") {
        return { decision, logs };
      }
    }

    const decision = this.pickDecision(decisions, context);
    if (decision) {
      return { decision, logs };
    }

    const fallback: AuditDecision = {
      action: this.config.defaultAction ?? "allow",
    };
    return { decision: fallback, logs };
  }

  getConfig(): SecurityAuditConfig {
    return this.config;
  }

  private rebuildRules(): void {
    const rules = this.factory.updateRules(this.config.rules);
    this.rulesByEvent = new Map();
    for (const rule of rules) {
      const list = this.rulesByEvent.get(rule.event) ?? [];
      list.push(rule);
      this.rulesByEvent.set(rule.event, list);
    }
  }

  private attachUsage(rule: AuditRule, context: AuditContext): AuditContext {
    const ruleConfig = this.config.rules.find((config) => {
      const key = `${config.type}:${config.event}:${config.matcher}:${config.action}:${config.id ?? ""}`;
      const ruleKey = `${rule.type}:${rule.event}:${rule.matcher.source}:${rule.action}:${rule.id}`;
      return key === ruleKey || config.id === rule.id;
    });

    if (!ruleConfig?.rateLimit) {
      return context;
    }

    const trackerKey = `${rule.id}:${context.sessionId ?? "global"}`;
    const now = Date.now();
    const existing = this.usageCounters.get(trackerKey) ?? {
      timestamps: [],
      config: ruleConfig.rateLimit,
    };

    const windowStart = now - ruleConfig.rateLimit.windowMs;
    const timestamps = existing.timestamps.filter((ts) => ts >= windowStart);
    timestamps.push(now);

    this.usageCounters.set(trackerKey, {
      timestamps,
      config: ruleConfig.rateLimit,
    });

    return {
      ...context,
      toolUsage: {
        count: timestamps.length,
        maxCalls: ruleConfig.rateLimit.maxCalls,
        windowMs: ruleConfig.rateLimit.windowMs,
      },
    };
  }

  private pickDecision(decisions: AuditDecision[], context: AuditContext): AuditDecision | undefined {
    if (decisions.length === 0) {
      return undefined;
    }

    const sorted = [...decisions].sort(
      (left, right) => ACTION_PRIORITY[right.action] - ACTION_PRIORITY[left.action]
    );

    const top = sorted[0];
    if (top.action === "log") {
      return {
        action: this.config.defaultAction ?? "allow",
        reason: top.reason,
        ruleId: top.ruleId,
        metadata: top.metadata,
      };
    }

    return {
      ...top,
      metadata: {
        ...top.metadata,
        event: context.event,
      },
    };
  }

  private buildLogEntry(context: AuditContext, decision: AuditDecision): AuditLogEntry {
    return {
      timestamp: context.timestamp,
      event: context.event,
      toolName: context.toolName,
      toolUseId: context.toolUseId,
      sessionId: context.sessionId,
      action: decision.action,
      reason: decision.reason,
      ruleId: decision.ruleId,
      metadata: decision.metadata,
    };
  }
}
