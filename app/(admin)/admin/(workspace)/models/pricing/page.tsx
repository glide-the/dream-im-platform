import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function PricingPage() {
  return <AdminModulePage eyebrow="AI supply chain / pricing" title="Pricing" description="统一使用每百万 Token 的整数 micro-USD，按用户层级和生效时间窗定价。历史请求保存价格快照，不回写旧账。" status="micro-USD" tabs={modelTabs}>
    <AdminCrudWorkbench resource="pricing-rules" title="定价规则" description="服务端拒绝冲突时间窗；更改新规则不会覆盖历史 Gateway 请求中的价格快照。" createTemplate={{ modelId: "model_...", userTier: "default", inputPriceMicrousdPerMillion: 3000000, outputPriceMicrousdPerMillion: 15000000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: "2026-08-08T00:00:00.000Z", effectiveTo: null }} updateTemplate={{ inputPriceMicrousdPerMillion: 3000000, outputPriceMicrousdPerMillion: 15000000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, status: "active" }} allowDelete={false} />
    <AdminResourceTable resource="pricing-rules" title="定价时间线" description="按模型、用户层级与生效时间核对定价。" defaultSort="effective_from" filters={[{ field: "model_code", label: "模型" }, { field: "user_tier", label: "用户层级", operator: "eq" }, { field: "status", label: "状态", operator: "eq", options: [{ label: "生效", value: "active" }, { label: "停用", value: "disabled" }] }]} columns={[{ key: "id", label: "Pricing ID" }, { key: "model_code", label: "模型" }, { key: "user_tier", label: "用户层级" }, { key: "input_price_microusd_per_million", label: "Input", format: "money" }, { key: "output_price_microusd_per_million", label: "Output", format: "money" }, { key: "cache_read_price_microusd_per_million", label: "Cache read", format: "money" }, { key: "status", label: "状态", format: "status" }, { key: "effective_from", label: "生效时间", format: "date" }]} />
  </AdminModulePage>;
}
