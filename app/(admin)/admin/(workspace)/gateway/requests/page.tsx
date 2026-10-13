// [Input] Shared Gateway request resource, safe display fields, and Admin request filters.
// [Output] Read-only lifecycle table that renders unknown Image charges as unknown rather than zero.
// [Pos] Gateway request-history page; detail authorization and accounting facts remain server-owned.
// [Sync] 2026-10-09: consume the null-safe charged amount projection for Image requests.
// [Sync] 2026-10-10: own text/Image request filtering and safe usage presentation in the existing log module.

import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function GatewayRequestsPage() {
  return <AdminModulePage eyebrow="Proxy gateway / request trace" title="请求日志" description="追踪鉴权、预授权、Provider、模型解析、流式状态、Token、错误与自动结算终态；失败只记录，不提供人工结算操作。" status="只读记录" tabs={gatewayTabs}>
    <AdminResourceTable resource="gateway-requests" title="Gateway 请求" description="按调用类型、用户、模型、Provider 和时间定位请求；图像正文不捕获，费用沿用平台结算。"
      filters={[
        { field: "email", label: "用户邮箱" }, { field: "requested_model", label: "请求模型" },
        { field: "provider_code", label: "Provider" },
        { field: "operation", label: "调用类型", operator: "eq", options: [{ label: "文本", value: "text" }, { label: "图像生成", value: "images.generations" }, { label: "图像编辑", value: "images.edits" }] },
        { field: "protocol", label: "协议", operator: "eq", options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] },
        { field: "status", label: "状态", operator: "eq" }, { field: "outcome", label: "结果", operator: "eq" },
        { id: "created-from", field: "created_at", label: "开始时间", operator: "gte", inputType: "datetime-local" },
        { id: "created-to", field: "created_at", label: "结束时间", operator: "lte", inputType: "datetime-local" },
        { field: "error_code", label: "错误码", operator: "eq" },
      ]}
      columns={[
        { key: "id", label: "Request ID" }, { key: "email", label: "用户" },
        { key: "operation", label: "调用类型", format: "status" }, { key: "protocol", label: "协议", format: "status" },
        { key: "requested_model", label: "请求模型" }, { key: "provider_code", label: "Provider" },
        { key: "status", label: "状态", format: "status" }, { key: "outcome", label: "结果", format: "status" },
        { key: "usage_known", label: "用量状态", format: "usage" },
        { key: "http_status", label: "HTTP" }, { key: "error_code", label: "错误码" },
        { key: "error_message", label: "具体原因" }, { key: "latency_ms", label: "延迟 ms" },
        { key: "display_charged_microusd", label: "收费", format: "money" }, { key: "created_at", label: "时间", format: "date" },
      ]} />
  </AdminModulePage>;
}
