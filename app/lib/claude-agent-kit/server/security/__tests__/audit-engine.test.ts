import { describe, expect, it } from "vitest";
import { AuditRuleFactory, SecurityAuditEngine } from "../index";
import type { AuditRuleConfig } from "../types";

const nowIso = () => new Date().toISOString();

describe("SecurityAuditEngine", () => {
  it("reuses flyweight rules from the factory", () => {
    const factory = new AuditRuleFactory();
    const config: AuditRuleConfig = {
      type: "network",
      event: "pre_tool_use",
      matcher: "WebFetch",
      action: "allow",
      reason: "Allow fetch",
    };

    const ruleA = factory.getOrCreateRule(config);
    const ruleB = factory.getOrCreateRule(config);

    expect(ruleA).toBe(ruleB);
  });

  it("denies network requests outside allowlist", () => {
    const engine = new SecurityAuditEngine({
      rules: [],
      sandbox: {
        network: { allowedDomains: ["example.com"] },
      },
    });

    const result = engine.evaluate({
      event: "pre_tool_use",
      toolName: "WebFetch",
      toolInput: { url: "https://evil.com" },
      timestamp: nowIso(),
    });

    expect(result.decision.action).toBe("deny");
  });

  it("marks dangerous bash commands for confirmation", () => {
    const engine = new SecurityAuditEngine({
      rules: [
        {
          type: "bash",
          event: "pre_tool_use",
          matcher: "Bash",
          action: "allow",
          reason: "Confirm dangerous commands",
        },
      ],
    });

    const result = engine.evaluate({
      event: "pre_tool_use",
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
      timestamp: nowIso(),
    });

    expect(result.decision.action).toBe("ask");
  });
});
