import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AdminSystemPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Runtime configuration</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">系统设置</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
          管理控制台与网关的结构化运行参数。敏感设置在列表和详情接口中始终脱敏显示。
        </p>
      </header>
      <AdminCrudWorkbench
        resource="system-settings"
        title="设置维护"
        description="以分类和键唯一标识设置；敏感值仅可覆盖，读取时不会返回明文。"
        createTemplate={{ category: "gateway", key: "routing-policy", value: { strategy: "cost-aware" }, description: "模型路由策略", isSecret: false, status: "active" }}
        updateTemplate={{ value: { strategy: "cost-aware" }, description: "模型路由策略", status: "active" }}
      />
      <AdminResourceTable
        resource="system-settings"
        title="System Settings"
        description="按 category / key 管理的 PostgreSQL 配置项。"
        defaultSort="updated_at"
        columns={[
          { key: "id", label: "Setting ID" },
          { key: "category", label: "分类" },
          { key: "key", label: "键" },
          { key: "value", label: "值", format: "json" },
          { key: "is_secret", label: "敏感", format: "boolean" },
          { key: "status", label: "状态", format: "status" },
          { key: "updated_at", label: "更新时间", format: "date" },
        ]}
      />
    </div>
  );
}
