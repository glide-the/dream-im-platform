import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function ModelsPage() {
  return <AdminModulePage eyebrow="AI supply chain / models" title="Models" description="稳定模型别名与上游型号解耦，Provider 是必填父实体；能力和上下文配置在启用前完成核对。" status="外键关联" tabs={modelTabs}>
    <AdminCrudWorkbench resource="models" title="模型映射" description="创建或更新上游型号、能力、上下文和启用状态。已产生历史请求的模型不可硬删除。" createTemplate={{ providerId: "provider_...", code: "claude-sonnet", upstreamModel: "claude-sonnet-4", displayName: "Claude Sonnet", contextWindow: 200000, maxOutputTokens: 8192, capabilities: { chat: true, streaming: true }, enabled: false }} updateTemplate={{ upstreamModel: "claude-sonnet-4", displayName: "Claude Sonnet", contextWindow: 200000, maxOutputTokens: 8192, capabilities: { chat: true, streaming: true }, enabled: false }} allowDelete={false} />
    <AdminResourceTable resource="models" title="模型注册表" description="客户端使用 code；resolved_model 与上游型号会随请求保存。" filters={[{ field: "code", label: "模型别名" }, { field: "provider_code", label: "Provider", operator: "eq" }, { field: "enabled", label: "状态", operator: "eq", options: [{ label: "启用", value: "true" }, { label: "停用", value: "false" }] }]} columns={[{ key: "id", label: "Model ID" }, { key: "code", label: "模型别名" }, { key: "provider_code", label: "Provider" }, { key: "upstream_model", label: "上游型号" }, { key: "display_name", label: "显示名" }, { key: "context_window", label: "Context" }, { key: "max_output_tokens", label: "Max output" }, { key: "enabled", label: "状态", format: "boolean" }]} />
  </AdminModulePage>;
}
