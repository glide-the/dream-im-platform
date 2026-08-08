import AdminModulePage, { billingTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function BillingUsagePage() {
  return <AdminModulePage eyebrow="Token billing / usage" title="使用记录" description="按请求保留 Input、Output、缓存 Token、Provider 成本和实际收费，关联用户、模型、协议与结算终态。" status="只读事实" tabs={billingTabs}>
    <AdminResourceTable resource="usage" title="Token 使用明细" description="用量记录来自 Gateway 请求生命周期，不允许在后台覆盖或删除。" filters={[{ field: "email", label: "用户邮箱" }, { field: "requested_model", label: "请求模型" }, { field: "protocol", label: "协议", operator: "eq", options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] }, { field: "outcome", label: "结果", operator: "eq" }]} columns={[{ key: "id", label: "Request ID" }, { key: "email", label: "用户" }, { key: "requested_model", label: "请求模型" }, { key: "resolved_model", label: "实际模型" }, { key: "outcome", label: "结果", format: "status" }, { key: "input_tokens", label: "Input" }, { key: "output_tokens", label: "Output" }, { key: "cache_read_tokens", label: "Cache read" }, { key: "charged_microusd", label: "收费", format: "money" }, { key: "created_at", label: "时间", format: "date" }]} />
  </AdminModulePage>;
}
