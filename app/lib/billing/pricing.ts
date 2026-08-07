import type { EffectivePricingRule } from "./types";

function isEffective(rule: EffectivePricingRule, at: Date) {
  return (
    rule.status === "active" &&
    rule.effectiveFrom.getTime() <= at.getTime() &&
    (!rule.effectiveTo || rule.effectiveTo.getTime() > at.getTime())
  );
}

/** Selects the newest exact-tier rule, then the newest default-tier rule. */
export function selectPricingRule(
  rules: EffectivePricingRule[],
  userTier: string,
  at = new Date(),
) {
  const candidates = rules
    .filter((rule) => isEffective(rule, at))
    .sort(
      (left, right) =>
        right.effectiveFrom.getTime() - left.effectiveFrom.getTime(),
    );
  return (
    candidates.find((rule) => rule.userTier === userTier) ??
    candidates.find((rule) => rule.userTier === "default") ??
    null
  );
}
