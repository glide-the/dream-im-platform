import AdminModulePage, { userResourceTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import { PlatformUsersResourceView } from "@/components/admin/AdminResourceViews";

export default function UsersPage() {
  return <AdminModulePage eyebrow="Users and resources / identities" title="平台用户" description="真实业务用户来自源 users；platform_users 仅作为计费与网关 Crosswalk。" status="双层身份" tabs={userResourceTabs}>
    <AdminResourceTable resource="source-users" title="真实业务用户" description="源用户安全字段只读；password_hash 永不进入查询或响应。" filters={[{ field: "email", label: "Email" }, { field: "display_name", label: "显示名" }, { field: "role", label: "业务角色", operator: "eq" }]} columns={[{ key: "id", label: "Source User ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "role", label: "业务角色", format: "status" }, { key: "created_at", label: "创建时间", format: "date" }]} />
    <PlatformUsersResourceView />
  </AdminModulePage>;
}
