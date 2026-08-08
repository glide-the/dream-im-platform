import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function ProvidersPage() {
  return <AdminModulePage eyebrow="AI supply chain / providers" title="Provider" description="配置协议端点、超时、重试和凭据。密钥只允许写入或轮换，列表与详情永不回显明文。" status="凭据加密" tabs={modelTabs}>
    <AdminCrudWorkbench resource="providers" title="Provider 配置" description="先以 disabled 建立并核对端点，再由有权限的运营人员启用。停用替代硬删除。" createTemplate={{ code: "anthropic-main", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "replace-with-provider-key", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: { authMode: "x-api-key" } }} updateTemplate={{ name: "Anthropic", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: { authMode: "x-api-key" } }} allowDelete={false} />
    <AdminResourceTable resource="providers" title="Provider 注册表" description="指纹用于核对轮换；credential_configured 只表示是否配置，不暴露 Secret。" filters={[{ field: "name", label: "名称" }, { field: "protocol", label: "协议", operator: "eq", options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] }, { field: "status", label: "状态", operator: "eq", options: [{ label: "启用", value: "active" }, { label: "停用", value: "disabled" }] }]} columns={[{ key: "id", label: "Provider ID" }, { key: "code", label: "Code" }, { key: "name", label: "名称" }, { key: "protocol", label: "协议", format: "status" }, { key: "base_url", label: "Endpoint" }, { key: "status", label: "状态", format: "status" }, { key: "credential_configured", label: "凭据", format: "boolean" }, { key: "api_key_fingerprint", label: "指纹" }]} />
  </AdminModulePage>;
}
