import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { systemTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function SystemSettingsPage() {
  return <AdminModulePage eyebrow="System and audit / settings" title="系统设置" description="管理控制台与 Gateway 的结构化运行参数。Secret 只允许覆盖，列表和详情始终返回 masked 标记。" status="Secret 脱敏" tabs={systemTabs}>
    <AdminCrudWorkbench resource="system-settings" title="设置维护" description="category / key 唯一标识设置；敏感值无法通过 API 取回。" createTemplate={{ category: "gateway", key: "routing-policy", value: { strategy: "cost-aware" }, description: "模型路由策略", isSecret: false, status: "active" }} updateTemplate={{ value: { strategy: "cost-aware" }, description: "模型路由策略", status: "active" }} />
    <AdminResourceTable resource="system-settings" title="系统配置项" description="按分类、键、敏感性与状态查询。" defaultSort="updated_at" filters={[{ field: "category", label: "分类", operator: "eq" }, { field: "key", label: "键" }, { field: "is_secret", label: "敏感", operator: "eq", options: [{ label: "是", value: "true" }, { label: "否", value: "false" }] }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "id", label: "Setting ID" }, { key: "category", label: "分类" }, { key: "key", label: "键" }, { key: "value", label: "值", format: "json" }, { key: "is_secret", label: "敏感", format: "boolean" }, { key: "status", label: "状态", format: "status" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
