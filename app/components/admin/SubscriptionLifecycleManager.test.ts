// UI contract tests for explicit subscription plan-change and cancellation entry points.
import { describe, expect, it } from "vitest";

import {
  subscriptionApiErrorMessage,
  subscriptionQuickActions,
} from "./SubscriptionLifecycleManager";

describe("subscription lifecycle manager actions", () => {
  it("exposes plan change and cancellation for a callable subscription", () => {
    expect(subscriptionQuickActions("active")).toEqual([
      { action: "upgrade", label: "更换套餐", tone: "default" },
      { action: "cancel", label: "期末取消", tone: "danger" },
    ]);
    expect(subscriptionQuickActions("trial")).toHaveLength(2);
  });

  it("offers cancellation reversal only while cancellation is scheduled", () => {
    expect(subscriptionQuickActions("cancel_at_period_end")).toEqual([
      {
        action: "revoke_cancel",
        label: "撤销期末取消",
        tone: "default",
      },
    ]);
    expect(subscriptionQuickActions("cancelled")).toEqual([]);
  });

  it("turns duplicate activation conflicts into plan-change guidance", () => {
    expect(
      subscriptionApiErrorMessage(
        { error: { code: "SUBSCRIPTION_ALREADY_CALLABLE" } },
        409,
      ),
    ).toContain("更换套餐");
    expect(
      subscriptionApiErrorMessage(
        { error: { code: "OTHER", message: "具体错误" } },
        409,
      ),
    ).toBe("具体错误");
  });
});
