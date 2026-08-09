import { describe, expect, it } from "vitest";
import { gatewayTabs, modelTabs } from "./AdminModulePage";

describe("Admin module navigation", () => {
  it("keeps model configuration separate from gateway limit policy", () => {
    expect(modelTabs).toEqual([
      { label: "Provider", href: "/admin/models/providers" },
      { label: "Models", href: "/admin/models/models" },
      { label: "Pricing", href: "/admin/models/pricing" },
    ]);
    expect(modelTabs).not.toContainEqual(
      expect.objectContaining({ href: "/admin/models/permissions" }),
    );
    expect(gatewayTabs).toContainEqual({
      label: "限流策略",
      href: "/admin/gateway/rate-limits",
    });
  });
});
