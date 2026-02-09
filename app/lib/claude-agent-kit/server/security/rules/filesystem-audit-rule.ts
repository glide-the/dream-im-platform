import path from "node:path";
import { BaseAuditRule } from "../audit-rule";
import type { AuditContext, AuditDecision, AuditRuleConfig } from "../types";
import { pickString } from "./rule-utils";

export class FileSystemAuditRule extends BaseAuditRule {
  private protectedPaths?: string[];

  constructor(config: AuditRuleConfig) {
    super(config);
    this.protectedPaths = config.protectedPaths?.map((entry) => path.resolve(entry));
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (context.event !== this.event) {
      return null;
    }
    const toolName = context.toolName;
    if (!toolName || !this.matcher.test(toolName)) {
      return null;
    }

    const targetPath = pickString(context.toolInput, ["path", "filePath", "filepath", "destination"]);
    if (!targetPath) {
      return null;
    }
    const resolvedPath = path.resolve(targetPath);

    if (this.protectedPaths && this.protectedPaths.length > 0) {
      const blocked = this.protectedPaths.some((blockedPath) => resolvedPath.startsWith(blockedPath));
      if (blocked) {
        return {
          ...this.createDecision(context, { path: resolvedPath, protectedPaths: this.protectedPaths }),
          action: "deny",
        };
      }
    }

    return this.createDecision(context, { path: resolvedPath });
  }
}
