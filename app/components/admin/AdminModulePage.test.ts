// [Input] Shared Admin module navigation definitions.
// [Output] Regression proof that model-center and Gateway policy navigation remain separated.
// [Pos] Provider-free navigation unit test; it does not render protected Admin routes.
// [Sync] 2026-10-10: verify independent AI/Image centers each have Provider, Models, and Pricing.
// [Sync] 2026-10-10: render the Image shell to reject request-history and billing entry points.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/image-models/models" }));
import { gatewayTabs, imageModelTabs, modelTabs } from "./AdminModulePage";
import ImageModelCenterPage from "./ImageModelCenterPage";

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

  it("gives Image management its own three-column navigation", () => {
    expect(imageModelTabs).toEqual([
      { label: "Provider", href: "/admin/image-models/providers" },
      { label: "Models", href: "/admin/image-models/models" },
      { label: "Pricing", href: "/admin/image-models/pricing" },
    ]);
    expect(modelTabs.some((tab) => tab.href.startsWith("/admin/image-models"))).toBe(false);
  });

  it("renders only model configuration links in the Image center shell", () => {
    const html = renderToStaticMarkup(createElement(ImageModelCenterPage, null, "Model content"));
    expect(html).toContain("Model content");
    expect(html.match(/href=/g)).toHaveLength(3);
    expect(html).not.toContain("请求记录");
    expect(html).not.toContain("/admin/gateway/");
    expect(html).not.toContain("/admin/billing/");
  });
});
