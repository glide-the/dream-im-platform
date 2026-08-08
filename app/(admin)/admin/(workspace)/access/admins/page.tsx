import AdminAccessActions from "@/components/admin/AdminAccessActions";
import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { accessTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AdminsPage() {
  return <AdminModulePage eyebrow="Access governance / administrators" title="管理员" description="服务端 Session、管理员状态与角色共同决定访问。管理员身份使用停用策略，密码与密码哈希永不回显。" status="Session + RBAC" tabs={accessTabs}>
    <AdminAccessActions />
    <AdminCrudWorkbench resource="admin-users" title="管理员维护" description="按 ID 修改显示名、状态、密码或角色；管理员不可硬删除。" createTemplate={{ email: "operator@example.com", displayName: "运营管理员", password: "replace-with-14-char-password", roleCodes: ["operator"] }} updateTemplate={{ displayName: "运营管理员", status: "active", roleCodes: ["operator"] }} allowDelete={false} />
    <AdminResourceTable resource="admin-users" title="管理员清单" description="角色投影、状态与最近登录；服务端仍会在每个 API 重验 permission。" filters={[{ field: "email", label: "Email" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "id", label: "Admin ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "roles", label: "角色", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "last_login_at", label: "最近登录", format: "date" }, { key: "created_at", label: "创建时间", format: "date" }]} />
  </AdminModulePage>;
}
