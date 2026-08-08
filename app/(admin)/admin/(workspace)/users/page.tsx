import AdminResourceTable from "@/components/admin/AdminResourceTable";
import UserCenterActions from "@/components/admin/UserCenterActions";
import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">User operations</p><h1 className="mt-2 font-display text-3xl font-semibold">平台用户与额度</h1><p className="mt-3 text-sm text-text-secondary">统一维护 Story 用户身份、套餐、模型调用配额、余额与网关密钥。</p></header>
      <UserCenterActions />
      <AdminCrudWorkbench
        resource="platform-users"
        title="平台用户维护"
        description="创建用户或更新套餐、状态、默认 Token 限额和元数据。用户使用关闭状态而非硬删除。"
        createTemplate={{ source: "ink-memory", externalUserId: "external-user-id", email: "user@example.com", displayName: "创作者", tier: "free", status: "active", dailyTokenLimit: null, monthlyTokenLimit: null, metadata: {} }}
        updateTemplate={{ tier: "free", status: "active", dailyTokenLimit: null, monthlyTokenLimit: null, metadata: {} }}
        allowDelete={false}
      />
      <AdminResourceTable resource="platform-users" title="Platform Users" description="计费身份、套餐与默认 Token 配额。" columns={[{ key: "id", label: "ID" }, { key: "source", label: "来源" }, { key: "external_user_id", label: "外部用户" }, { key: "email", label: "Email" }, { key: "tier", label: "套餐" }, { key: "status", label: "状态", format: "status" }]} />
      <AdminResourceTable resource="gateway-api-keys" title="Gateway API Keys" description="这里只显示前缀；明文密钥无法恢复。" columns={[{ key: "key_prefix", label: "前缀" }, { key: "email", label: "用户" }, { key: "name", label: "名称" }, { key: "scopes", label: "Scopes", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "last_used_at", label: "最近使用", format: "date" }]} />
    </div>
  );
}
