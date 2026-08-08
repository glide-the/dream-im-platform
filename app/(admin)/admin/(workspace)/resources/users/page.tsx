import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { userResourceTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function UsersPage() {
  return <AdminModulePage eyebrow="Users and resources / identities" title="平台用户" description="真实业务用户来自源 users 表；platform_users 仅作为计费与网关身份 Crosswalk，不替代业务用户主数据。" status="双层身份" tabs={userResourceTabs}>
    <AdminResourceTable resource="source-users" title="真实业务用户" description="只读展示源用户安全字段；password_hash 永不进入查询或响应。" filters={[{ field: "email", label: "Email" }, { field: "display_name", label: "显示名" }, { field: "role", label: "业务角色", operator: "eq" }]} columns={[{ key: "id", label: "Source User ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "role", label: "业务角色", format: "status" }, { key: "created_at", label: "创建时间", format: "date" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
    <AdminCrudWorkbench resource="platform-users" title="计费身份 Crosswalk" description="把真实业务用户 ID 映射为计费身份并配置套餐与默认额度。停用替代硬删除。" createTemplate={{ source: "ink-dream", externalUserId: "source-user-id", email: "user@example.com", displayName: "创作者", tier: "free", status: "active", dailyTokenLimit: null, monthlyTokenLimit: null, metadata: {} }} updateTemplate={{ email: "user@example.com", displayName: "创作者", tier: "free", status: "active", dailyTokenLimit: null, monthlyTokenLimit: null, metadata: {} }} allowDelete={false} />
    <AdminResourceTable resource="platform-users" title="计费用户映射" description="用于 Gateway Key、模型权限、余额和账本；external_user_id 保存源业务主键。" filters={[{ field: "email", label: "Email" }, { field: "source", label: "来源", operator: "eq" }, { field: "tier", label: "套餐", operator: "eq" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "id", label: "Platform User ID" }, { key: "source", label: "来源" }, { key: "external_user_id", label: "源用户 ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "tier", label: "套餐" }, { key: "status", label: "状态", format: "status" }]} />
  </AdminModulePage>;
}
