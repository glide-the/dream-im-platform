// [Input] Provider creation route, product presets, and shared generic Provider fields.
// [Output] Disabled-first Provider setup with one managed product account per Provider.
// [Pos] Shared Provider full-page form for the independent AI and Image centers; server owns validation, persistence, RBAC, and audit.
// [Sync] 2026-10-10: reuse one Provider form, with Codex/OpenAI Image presets and context-local returns.
// [Sync] 2026-10-09: make the real OpenAI preset Images-ready and list the two public Images routes.
// [Sync] 2026-10-09: serialize the no-upstream-usage-query default as the existing `none` enum.
// [Sync] 2026-10-10: generic OpenAI defaults to Chat; Responses is an explicit server-validated selection.

import AdminResourceFormPage from "./AdminResourceFormPage";
import ProviderManagedAuthPanel from "./ProviderManagedAuthPanel";
import type { AdminFieldDefinition } from "./AdminResourceManager";
import { providerFields } from "./provider-fields";

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
  help: "一条托管 Provider 只连接一个账号；类型创建后不可修改。",
};

const fields = [adapterField, ...providerFields];

const sections = [
  { id: "identity", title: "预设与基础信息", description: "先选择接入方式和稳定 Code；同产品有多个账号时，用显示名称区分用途。" },
  { id: "connection", title: "Endpoint", description: "填写上游兼容入口，不把地址藏在 JSON 中。" },
  { id: "credential", title: "静态凭据", description: "Secret 只写入加密列；Bearer 仅指请求头格式，并非 OAuth 登录。显隐只作用于本次草稿。" },
  { id: "runtime", title: "运行策略", description: "超时和重试共同决定代理失败边界。" },
  { id: "advanced", title: "模型目录与高级配置", description: "没有 /models 接口时选择手工模式并填写实际上游型号；已知键使用具名控件。" },
];

const presets = [
  { label: "Codex / ChatGPT", description: "创建一个连接 ChatGPT 账号的 Provider；保存后完成账号授权。", values: { adapterKind: "codex", name: "Codex", protocol: "openai", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_completion_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "xAI / Grok", description: "创建一个连接 xAI 账号的 Provider；保存后完成账号授权。", values: { adapterKind: "xai", name: "xAI", protocol: "openai", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "GitHub Copilot", description: "创建一个连接 GitHub Copilot 账号的 Provider；保存后完成账号授权。", values: { adapterKind: "github_copilot", name: "GitHub Copilot", protocol: "openai", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "Anthropic Official", description: "Anthropic 原生 Messages API。", values: { code: "anthropic-main", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "x-api-key", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "DeepSeek Anthropic", description: "DeepSeek Anthropic 兼容入口；Bearer 是静态凭据发送方式，不代表 OAuth。", values: { code: "deepseek-anthropic", name: "DeepSeek", protocol: "anthropic", baseUrl: "https://api.deepseek.com/anthropic", authMode: "bearer", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "OpenAI Official", description: "OpenAI 主对话可选择 Chat 或 Responses；Images 工具独立配置。API Key 通过静态 Bearer 请求头发送。", values: { code: "openai-main", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com", authMode: "bearer", openaiApi: "chat", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_completion_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: { imageApi: { kind: "openai" } } } },
  { label: "自定义兼容端点", description: "适用于无 /models 的 OpenAI 兼容入口；手工填写上游型号。", values: { code: "custom-provider", name: "Custom Provider", protocol: "openai", baseUrl: "https://example.com", authMode: "bearer", modelCatalogMode: "manual", manualModel: "", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
];

function ProviderContext({ imageMode = false }: { imageMode?: boolean }) {
  if (imageMode) return <section className="rounded-2xl border border-border bg-bg-surface p-5"><h2 className="font-display text-lg font-semibold">图像服务连接</h2><p className="mt-2 text-sm text-text-secondary">调用方使用已授权的 Gateway 身份生成或编辑图片；此处不提供创作或图片存储。</p></section>;
  return <section className="rounded-2xl border border-border bg-bg-surface p-5"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Proxy publication</p><h2 className="mt-2 font-display text-lg font-semibold">对外代理</h2><p className="mt-2 text-xs leading-5 text-text-secondary">ink-dream-memory 使用 Gateway Key 和模型 alias 调用：</p><ul className="mt-3 space-y-2 font-mono text-[10px] text-text-tertiary"><li>POST /v1/messages</li><li>POST /v1/messages/count_tokens</li><li>POST /v1/chat/completions</li><li>POST /v1/images/generations</li><li>POST /v1/images/edits</li><li>GET /v1/models</li></ul></section>;
}

const editSections = [
  { id: "identity", title: "Provider 身份", description: "Code 与协议只读；如需更换协议，请新建 Provider。" },
  { id: "connection", title: "Endpoint" },
  { id: "credential", title: "静态凭据轮换", description: "留空表示保留当前有效凭据；新凭据验证成功前不会替换旧值。Bearer 不是 OAuth 登录。" },
  { id: "runtime", title: "运行与启停" },
  { id: "advanced", title: "模型目录与高级配置", description: "无 /models 接口时使用手工模型模式；已登记 Model 不受模式切换影响。" },
];


const imageFields = [
  { ...adapterField, options: [
    { label: "OpenAI API · 静态凭据", value: "generic" },
    { label: "Codex / ChatGPT 账号", value: "codex" },
  ] }, ...providerFields.map((field) => {
    if (field.key === "protocol") return { ...field, options: [{ label: "OpenAI", value: "openai" }] };
    if (field.key === "config") return { ...field, excludeKeys: [...(field.excludeKeys ?? []), "imageApi"] };
    return field;
  }),
];
const imagePresets = presets.filter((preset) => ["Codex / ChatGPT", "OpenAI Official"].includes(preset.label));

export default function ProviderFormPage({ mode, recordId, imageMode = false }: {
  mode: "create" | "edit"; recordId?: string; imageMode?: boolean;
}) {
  const backHref = imageMode ? "/admin/image-models/providers" : "/admin/models/providers";
  const creating = mode === "create";
  return <AdminResourceFormPage mode={mode} resource="providers" recordId={recordId}
    title={creating ? "添加 Provider" : "编辑 Provider"} eyebrow={imageMode ? "Image model center · Provider" : "Provider settings"}
    description={imageMode ? "配置 Codex 或 OpenAI 图像服务。Provider 与 AI 模型中心共享，同一连接的修改会影响其关联模型。" : "每个 Provider 对应一个上游账号和一组运行配置。托管 Provider 保存后完成账号授权；所有 Provider 先停用创建。"}
    backHref={backHref} providerCenterPath={imageMode ? "/admin/image-models" : "/admin/models"} providerImageMode={imageMode}
    fields={imageMode ? imageFields : fields} sections={creating ? sections : editSections}
    defaults={{ adapterKind: "generic", protocol: imageMode ? "openai" : "anthropic", openaiApi: "chat", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: imageMode ? "bearer" : "x-api-key", usageSource: "none", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", config: imageMode && creating ? { imageApi: { kind: "openai" } } : {} }}
    presets={creating ? imageMode ? imagePresets : presets : undefined}
    submitLabel={creating ? "添加 Provider" : "保存 Provider"}
    context={creating ? <ProviderContext imageMode={imageMode} /> : undefined}
    contentBeforeFields={!creating && recordId ? <ProviderManagedAuthPanel providerId={recordId} imageMode={imageMode} /> : undefined}
    contentBeforeFieldsWhen="managed-provider" />;
}

