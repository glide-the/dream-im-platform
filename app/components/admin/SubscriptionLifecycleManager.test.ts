// UI contract tests for subscription cancellation and reactivation entry points.
import { describe, expect, it } from "vitest";

import {
  subscriptionApiErrorMessage,
  subscriptionQuickActions,
} from "./SubscriptionLifecycleManager";

describe("subscription lifecycle manager actions", () => {
  it("exposes cancellation for callable and expired subscriptions", () => {
    expect(subscriptionQuickActions("active")).toEqual([
      { action: "cancel", label: "取消当前套餐", tone: "danger" },
    ]);
    expect(subscriptionQuickActions("trial")).toHaveLength(1);
    expect(subscriptionQuickActions("expired")).toEqual([
      { action: "cancel", label: "取消当前套餐", tone: "danger" },
    ]);
  });

  it("does not expose actions for a cancelled subscription", () => {
    expect(subscriptionQuickActions("cancel_at_period_end")).toEqual([
      { action: "cancel", label: "取消当前套餐", tone: "danger" },
    ]);
    expect(subscriptionQuickActions("cancelled")).toEqual([]);
  });

  it("turns duplicate activation conflicts into plan-change guidance", () => {
    expect(
      subscriptionApiErrorMessage(
        { error: { code: "SUBSCRIPTION_ALREADY_CALLABLE" } },
        409,
      ),
    ).toContain("取消当前套餐");
    expect(
      subscriptionApiErrorMessage(
        { error: { code: "OTHER", message: "具体错误" } },
        409,
      ),
    ).toBe("具体错误");
  });
});
