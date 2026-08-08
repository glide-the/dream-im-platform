import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function ModelPermissionsPage() {
  return <AdminModulePage eyebrow="AI supply chain / permissions" title="模型权限" description="平台计费用户与模型之间的显式授权、RPM 和 Token 限额覆盖；未配置记录时沿用用户默认策略。" status="User → Model" tabs={modelTabs}>
    <AdminCrudWorkbench resource="user-model-permissions" title="用户模型授权" description="为平台计费身份设置模型级覆盖；删除覆盖只恢复默认策略，不删除用户或模型。" createTemplate={{ platformUserId: "user_...", modelId: "model_...", enabled: true, requestsPerMinute: 30, dailyTokenLimit: null, monthlyTokenLimit: null }} updateTemplate={{ enabled: true, requestsPerMinute: 30, dailyTokenLimit: null, monthlyTokenLimit: null }} />
    <AdminResourceTable resource="user-model-permissions" title="授权矩阵" description="按用户和模型查询实际覆盖记录。" defaultSort="updated_at" filters={[{ field: "email", label: "用户邮箱" }, { field: "model_code", label: "模型" }, { field: "enabled", label: "是否允许", operator: "eq", options: [{ label: "允许", value: "true" }, { label: "禁止", value: "false" }] }]} columns={[{ key: "id", label: "Permission ID" }, { key: "email", label: "用户" }, { key: "model_code", label: "模型" }, { key: "enabled", label: "允许", format: "boolean" }, { key: "requests_per_minute", label: "RPM" }, { key: "daily_token_limit", label: "每日 Token" }, { key: "monthly_token_limit", label: "每月 Token" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
