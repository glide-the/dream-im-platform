import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { accessTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function RolesPage() {
  return <AdminModulePage eyebrow="Access governance / roles" title="角色" description="角色聚合权限代码。内置 super_admin、operator 和 auditor 受保护；仍被管理员使用的角色不能删除。" status="受保护关系" tabs={accessTabs}>
    <AdminCrudWorkbench resource="admin-roles" title="角色维护" description="创建自定义角色并绑定最小权限集；更新前核对权限影响范围。" createTemplate={{ code: "content_operator", name: "内容运营", description: "剧本内容运营角色", permissionCodes: ["dashboard.read", "story.read", "story.write"] }} updateTemplate={{ name: "内容运营", description: "剧本内容运营角色", permissionCodes: ["dashboard.read", "story.read", "story.write"] }} />
    <AdminResourceTable resource="admin-roles" title="角色—权限矩阵" description="详情抽屉展示完整 permissions 数组。" defaultSort="code" filters={[{ field: "code", label: "角色代码" }, { field: "name", label: "名称" }]} columns={[{ key: "id", label: "Role ID" }, { key: "code", label: "Role" }, { key: "name", label: "名称" }, { key: "description", label: "说明" }, { key: "permissions", label: "Permissions", format: "json" }]} />
  </AdminModulePage>;
}
