import { BaseAuditRule } from "../audit-rule";
import type { AuditContext, AuditDecision, AuditRuleConfig } from "../types";
import { pickString } from "./rule-utils";

export class NetworkAuditRule extends BaseAuditRule {
  private allowedDomains?: string[];

  constructor(config: AuditRuleConfig) {
    super(config);
    this.allowedDomains = config.allowedDomains?.map((domain) => domain.toLowerCase());
  }

  evaluate(context: AuditContext): AuditDecision | null {
    if (context.event !== this.event) {
      return null;
    }
    const toolName = context.toolName;
    if (!toolName || !this.matcher.test(toolName)) {
      return null;
    }
    const url = pickString(context.toolInput, ["url", "href"]);
    if (!url) {
      return null;
    }
    let hostname: string | undefined;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return this.createDecision(context, { url, invalidUrl: true });
    }

    if (this.allowedDomains && this.allowedDomains.length > 0) {
      const isAllowed = this.allowedDomains.some(
        (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
      );
      if (!isAllowed) {
        return {
          ...this.createDecision(context, { url, hostname, allowedDomains: this.allowedDomains }),
          action: "deny",
        };
      }
    }

    return this.createDecision(context, { url, hostname });
  }
}
