import AdminAccessActions from "@/components/admin/AdminAccessActions";
import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AdminAccessPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">RBAC control plane</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">权限管理</h1>
        <p className="mt-3 text-sm text-text-secondary">服务端 Session、角色与权限代码共同决定资源访问；管理员采用停用策略，自定义角色支持完整维护。</p>
      </header>
      <AdminAccessActions />
      <AdminCrudWorkbench
        resource="admin-users"
        title="管理员维护"
        description="更新管理员显示名、状态、密码或角色；管理员身份不可硬删除。"
        createTemplate={{ email: "operator@example.com", displayName: "运营管理员", password: "replace-with-14-char-password", roleCodes: ["operator"] }}
        updateTemplate={{ displayName: "运营管理员", status: "active", roleCodes: ["operator"] }}
        allowDelete={false}
      />
      <AdminResourceTable resource="admin-users" title="Administrators" description="管理员身份、角色和最近登录状态。" columns={[{ key: "id", label: "Admin ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "名称" }, { key: "roles", label: "角色", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "last_login_at", label: "最近登录", format: "date" }, { key: "created_at", label: "创建时间", format: "date" }]} />
      <AdminCrudWorkbench
        resource="admin-roles"
        title="角色维护"
        description="创建自定义角色并绑定权限代码。内置角色不可删除，super_admin 权限集由迁移维护。"
        createTemplate={{ code: "content_operator", name: "内容运营", description: "剧本内容运营角色", permissionCodes: ["dashboard.read", "story.read", "story.write"] }}
        updateTemplate={{ name: "内容运营", description: "剧本内容运营角色", permissionCodes: ["dashboard.read", "story.read", "story.write"] }}
      />
      <AdminResourceTable resource="admin-roles" title="Roles" description="角色到权限代码的服务端映射。" defaultSort="code" columns={[{ key: "id", label: "Role ID" }, { key: "code", label: "Role" }, { key: "name", label: "名称" }, { key: "permissions", label: "Permissions", format: "json" }]} />
      <AdminResourceTable resource="admin-permissions" title="Permissions" description="服务端可执行的权限代码清单。" defaultSort="code" columns={[{ key: "code", label: "Permission" }, { key: "name", label: "名称" }, { key: "description", label: "说明" }]} />
    </div>
  );
}
