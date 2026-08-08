import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function GatewayRequestsPage() {
  return <AdminModulePage eyebrow="Proxy gateway / request trace" title="请求日志" description="追踪鉴权、预授权、Provider、模型解析、流式状态、Token、错误与自动结算终态；失败只记录，不提供人工结算操作。" status="只读记录" tabs={gatewayTabs}>
    <AdminResourceTable resource="gateway-requests" title="Gateway 请求" description="按 Request ID、用户、模型、协议、结果和错误码定位完整生命周期。" filters={[{ field: "email", label: "用户邮箱" }, { field: "requested_model", label: "请求模型" }, { field: "protocol", label: "协议", operator: "eq", options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] }, { field: "outcome", label: "结果", operator: "eq" }, { field: "error_code", label: "错误码", operator: "eq" }]} columns={[{ key: "id", label: "Request ID" }, { key: "email", label: "用户" }, { key: "protocol", label: "协议", format: "status" }, { key: "requested_model", label: "请求模型" }, { key: "provider_code", label: "Provider" }, { key: "status", label: "状态", format: "status" }, { key: "outcome", label: "结果", format: "status" }, { key: "http_status", label: "HTTP" }, { key: "latency_ms", label: "延迟 ms" }, { key: "charged_microusd", label: "收费", format: "money" }, { key: "created_at", label: "时间", format: "date" }]} />
  </AdminModulePage>;
}
