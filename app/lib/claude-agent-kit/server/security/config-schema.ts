import { z } from "zod";
import {
  auditActionSchema,
  auditEventSchema,
  auditRuleTypeSchema,
} from "./types";
import type { AuditRuleConfig, SecurityAuditConfig } from "./types";

const rateLimitSchema = z.object({
  maxCalls: z.number().int().positive(),
  windowMs: z.number().int().positive(),
});

const auditRuleConfigSchema = z.object({
  id: z.string().optional(),
  type: auditRuleTypeSchema,
  event: auditEventSchema,
  matcher: z.string().min(1),
  action: auditActionSchema,
  reason: z.string().optional(),
  allowedDomains: z.array(z.string()).optional(),
  protectedPaths: z.array(z.string()).optional(),
  excludedCommands: z.array(z.string()).optional(),
  rateLimit: rateLimitSchema.optional(),
});

const sandboxSchema = z.object({
  network: z
    .object({
      allowedDomains: z.array(z.string()).optional(),
    })
    .optional(),
  filesystem: z
    .object({
      protectedPaths: z.array(z.string()).optional(),
    })
    .optional(),
  excludedCommands: z.array(z.string()).optional(),
});

const securityAuditConfigSchema = z.object({
  rules: z.array(auditRuleConfigSchema),
  sandbox: sandboxSchema.optional(),
  hooks: z.record(auditEventSchema, z.array(z.string())).optional(),
  defaultAction: auditActionSchema.optional(),
  configVersion: z.string().optional(),
});

export function parseSecurityAuditConfig(input: unknown): SecurityAuditConfig {
  return securityAuditConfigSchema.parse(input);
}

export function getSecurityAuditConfigSchema() {
  return securityAuditConfigSchema;
}

export function normalizeSecurityAuditConfig(config: SecurityAuditConfig): SecurityAuditConfig {
  const rules: AuditRuleConfig[] = [...config.rules];

  if (config.sandbox?.network?.allowedDomains?.length) {
    rules.push({
      id: "sandbox-network-allowlist",
      type: "network",
      event: "pre_tool_use",
      matcher: ".*",
      action: "deny",
      reason: "Domain not in allowlist",
      allowedDomains: config.sandbox.network.allowedDomains,
    });
  }

  if (config.sandbox?.filesystem?.protectedPaths?.length) {
    rules.push({
      id: "sandbox-filesystem-protect",
      type: "filesystem",
      event: "pre_tool_use",
      matcher: ".*",
      action: "deny",
      reason: "Protected path access denied",
      protectedPaths: config.sandbox.filesystem.protectedPaths,
    });
  }

  if (config.sandbox?.excludedCommands?.length) {
    rules.push({
      id: "sandbox-bash-excluded",
      type: "bash",
      event: "pre_tool_use",
      matcher: ".*",
      action: "deny",
      reason: "Command denied by sandbox",
      excludedCommands: config.sandbox.excludedCommands,
    });
  }

  return {
    ...config,
    rules,
    defaultAction: config.defaultAction ?? "allow",
  };
}
