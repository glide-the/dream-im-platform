import AdminResourceTable from "@/components/admin/AdminResourceTable";
import GatewayReconciliationAction from "@/components/admin/GatewayReconciliationAction";

export default function AdminGatewayPage() {
  return (
    <div className="space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Proxy gateway</p><h1 className="mt-2 font-display text-3xl font-semibold">Claude / OpenAI 代理</h1><p className="mt-3 text-sm text-text-secondary">请求只记录归因、用量和错误分类，不保存完整 Prompt 与响应。</p></header>
      <GatewayReconciliationAction />
      <AdminResourceTable resource="gateway-requests" title="Gateway Requests" description="追踪预授权、流式状态、上游错误与结算结果。" columns={[{ key: "id", label: "Request" }, { key: "email", label: "用户" }, { key: "protocol", label: "协议" }, { key: "requested_model", label: "模型" }, { key: "status", label: "状态", format: "status" }, { key: "outcome", label: "结果", format: "status" }, { key: "http_status", label: "HTTP" }, { key: "latency_ms", label: "延迟 ms" }, { key: "charged_microusd", label: "计费", format: "money" }, { key: "created_at", label: "时间", format: "date" }]} />
    </div>
  );
}
