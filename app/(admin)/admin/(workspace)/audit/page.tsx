import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AdminAuditPage() {
  return (
    <div className="space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Immutable audit</p><h1 className="mt-2 font-display text-3xl font-semibold">审计日志</h1><p className="mt-3 text-sm text-text-secondary">所有管理写操作记录 actor、资源、请求 ID 与脱敏前后快照。</p></header>
      <AdminResourceTable resource="audit-logs" title="Audit Trail" description="数据库触发器禁止更新和删除。" columns={[{ key: "created_at", label: "时间", format: "date" }, { key: "actor_email", label: "操作者" }, { key: "action", label: "动作", format: "status" }, { key: "resource_type", label: "资源" }, { key: "resource_id", label: "资源 ID" }, { key: "request_id", label: "Request ID" }, { key: "ip_address", label: "IP" }]} />
    </div>
  );
}
