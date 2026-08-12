// Versioned platform policy shared by Drizzle schema, Admin UI, and data runners.
export const gatewayDefaultLimitsPolicy = Object.freeze({
  revision: "gateway-default-token-limits-v1",
  dailyTokenLimit: 1_000_000_000,
  monthlyTokenLimit: 10_000_000_000,
});
