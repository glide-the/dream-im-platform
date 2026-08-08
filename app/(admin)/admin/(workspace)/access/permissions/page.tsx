import AdminModulePage, { accessTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function PermissionsPage() {
  return <AdminModulePage eyebrow="Access governance / permissions" title="权限" description="权限代码由服务端定义并由迁移初始化。Refine 只据此隐藏无权操作，真正授权边界仍在 Route Handler 与服务层。" status="服务端权威" tabs={accessTabs}>
    <div className="border border-border bg-bg-secondary/45 p-4 text-sm leading-6 text-text-secondary"><strong className="text-text-primary">授权链：</strong>Admin Session → admin_user_roles → admin_role_permissions → admin_permissions → API 再校验。</div>
    <AdminResourceTable resource="permissions" title="权限代码" description="权限代码只读；新增系统能力时通过审查后的迁移更新。" defaultSort="code" filters={[{ field: "code", label: "权限代码" }, { field: "name", label: "名称" }]} columns={[{ key: "code", label: "Permission" }, { key: "name", label: "名称" }, { key: "description", label: "说明" }, { key: "created_at", label: "创建时间", format: "date" }]} />
  </AdminModulePage>;
}
