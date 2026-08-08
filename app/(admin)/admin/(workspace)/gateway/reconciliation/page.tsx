import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import GatewayReconciliationAction from "@/components/admin/GatewayReconciliationAction";

export default function GatewayReconciliationPage() {
  return <AdminModulePage eyebrow="Proxy gateway / reconciliation" title="错误与异常结算" description="聚焦 settlement_failed 请求。人工处置必须基于外部账单或日志证据，并原子更新用量、账本、配额与审计。" status="高风险确认" tabs={gatewayTabs}>
    <GatewayReconciliationAction />
    <AdminResourceTable resource="gateway-requests" title="待人工核对" description="仅显示 status=settlement_failed；完成处置后从队列移出，历史仍可在请求日志与账本查询。" defaultFilters={[{ field: "status", operator: "eq", value: "settlement_failed" }]} filters={[{ field: "email", label: "用户邮箱" }, { field: "requested_model", label: "模型" }, { field: "error_code", label: "错误码", operator: "eq" }]} columns={[{ key: "id", label: "Request ID" }, { key: "email", label: "用户" }, { key: "provider_code", label: "Provider" }, { key: "requested_model", label: "模型" }, { key: "status", label: "结算状态", format: "status" }, { key: "outcome", label: "结果", format: "status" }, { key: "error_code", label: "错误码" }, { key: "input_tokens", label: "Input" }, { key: "output_tokens", label: "Output" }, { key: "charged_microusd", label: "收费", format: "money" }, { key: "created_at", label: "时间", format: "date" }]} />
  </AdminModulePage>;
}
