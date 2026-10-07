// [Input] Daily, three-day and weekly operational review needs.
// [Output] Shared bounded display windows and hourly/provider-page aggregation policy.
// [Pos] Read-only observability policy; never controls Gateway selection or retries.
export const routingHealthWindows = [
  { value: "24h", label: "最近 24 小时", hours: 24 },
  { value: "3d", label: "最近 3 天", hours: 72 },
  { value: "7d", label: "最近 7 天", hours: 168 },
] as const;
export const routingHealthPolicy = { defaultWindow: "3d", bucketSeconds: 3600, providerPageSize: 20 } as const;
