import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import { ModelPermissionsResourceView } from "@/components/admin/AdminResourceViews";

export default function GatewayRateLimitsPage() {
  return <AdminModulePage eyebrow="Proxy gateway / rate limits" title="限流策略" description="用户—模型级 RPM、每日和每月 Token 限额由模型授权记录维护；运行窗口来自 gateway_rate_limits，只读展示实际计数。" status="策略 + 运行窗口" tabs={gatewayTabs}>
    <ModelPermissionsResourceView />
    <AdminResourceTable resource="gateway-rate-limits" title="实时限流窗口" description="按用户、模型和分钟/日/月窗口查看请求与 Token 计数。" defaultSort="window_start" filters={[{ field: "email", label: "用户邮箱" }, { field: "model_code", label: "模型" }, { field: "window_type", label: "窗口", operator: "eq" }]} columns={[{ key: "email", label: "用户" }, { key: "model_code", label: "模型" }, { key: "window_type", label: "窗口", format: "status" }, { key: "window_start", label: "窗口开始", format: "date" }, { key: "request_count", label: "请求数" }, { key: "token_count", label: "Token" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
