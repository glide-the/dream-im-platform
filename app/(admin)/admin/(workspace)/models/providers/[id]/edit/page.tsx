// [Input] Existing safe Provider projection plus static or managed authentication controls.
// [Output] Mode-aware Provider settings and a single managed account lifecycle surface.
// [Pos] Admin Provider edit page; credential switching remains an atomic server responsibility.
// [Sync] 2026-09-04: make one Provider to one managed account explicit.

import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import type { AdminFieldDefinition } from "@/components/admin/AdminResourceManager";
import ProviderManagedAuthPanel from "@/components/admin/ProviderManagedAuthPanel";
import { providerFields } from "@/components/admin/provider-fields";

const adapterField: AdminFieldDefinition = {
  key: "adapterKind",
  sourceKey: "adapter_kind",
  label: "Provider 类型",
  control: "select",
  section: "identity",
  required: true,
  createOnly: true,
  readOnlyOnEdit: true,
  options: [
    { label: "通用静态凭据", value: "generic" },
    { label: "Codex / ChatGPT 账号", value: "codex" },
    { label: "xAI / Grok 账号", value: "xai" },
    { label: "GitHub Copilot 账号", value: "github_copilot" },
  ],
};

const fields = [adapterField, ...providerFields];

const sections = [
  { id: "identity", title: "Provider 身份", description: "Code 与协议只读；如需更换协议，请新建 Provider。" },
  { id: "connection", title: "Endpoint" },
  { id: "credential", title: "静态凭据轮换", description: "留空表示保留当前有效凭据；新凭据验证成功前不会替换旧值。Bearer 不是 OAuth 登录。" },
  { id: "runtime", title: "运行与启停" },
  { id: "advanced", title: "模型目录与高级配置", description: "无 /models 接口时使用手工模型模式；已登记 Model 不受模式切换影响。" },
];

export default async function EditProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminResourceFormPage mode="edit" resource="providers" recordId={id} title="编辑 Provider" eyebrow="Provider settings" description="修改此 Provider 的运行策略与模型目录。托管 Provider 只连接一个账号；同一产品的其他账号请新建 Provider。" backHref="/admin/models/providers" fields={fields} sections={sections} defaults={{ adapterKind: "generic", authMode: "x-api-key", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", config: {} }} submitLabel="保存 Provider" contentBeforeFields={<ProviderManagedAuthPanel providerId={id} />} contentBeforeFieldsWhen="managed-provider" />;
}
