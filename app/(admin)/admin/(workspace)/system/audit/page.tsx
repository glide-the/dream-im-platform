import AdminModulePage from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AuditPage() {
  return <AdminModulePage eyebrow="System governance / immutable trail" title="审计日志" description="所有管理写操作记录操作者、资源、Request ID、IP 与脱敏前后快照。数据库触发器禁止更新和删除。" status="只追加">
    <AdminResourceTable resource="audit-logs" title="审计轨迹" description="通过 Request ID 串联 API 错误、源数据变更和高风险人工操作。" filters={[{ field: "actor_email", label: "操作者邮箱" }, { field: "action", label: "动作", operator: "eq" }, { field: "resource_type", label: "资源类型", operator: "eq" }, { field: "resource_id", label: "资源 ID", operator: "eq" }, { field: "request_id", label: "Request ID", operator: "eq" }]} columns={[{ key: "created_at", label: "时间", format: "date" }, { key: "actor_email", label: "操作者" }, { key: "action", label: "动作", format: "status" }, { key: "resource_type", label: "资源" }, { key: "resource_id", label: "资源 ID" }, { key: "request_id", label: "Request ID" }, { key: "ip_address", label: "IP" }]} />
  </AdminModulePage>;
}
