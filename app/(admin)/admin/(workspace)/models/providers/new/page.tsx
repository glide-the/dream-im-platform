// [Input] Provider creation route, product presets, and shared generic Provider fields.
// [Output] Disabled-first Provider setup with one managed product account per Provider.
// [Pos] Admin Provider onboarding page; server owns validation, persistence, RBAC, and audit.
// [Sync] 2026-09-04: explain that each managed account requires its own Provider.

import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import type { AdminFieldDefinition } from "@/components/admin/AdminResourceManager";
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
  { label: "OpenAI Official", description: "OpenAI Chat Completions 入口；API Key 通过静态 Bearer 请求头发送。", values: { code: "openai-main", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com", authMode: "bearer", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_completion_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "自定义兼容端点", description: "适用于无 /models 的 OpenAI 兼容入口；手工填写上游型号。", values: { code: "custom-provider", name: "Custom Provider", protocol: "openai", baseUrl: "https://example.com", authMode: "bearer", modelCatalogMode: "manual", manualModel: "", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
];

function ProviderContext() {
  return <section className="rounded-2xl border border-border bg-bg-surface p-5"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Proxy publication</p><h2 className="mt-2 font-display text-lg font-semibold">对外代理</h2><p className="mt-2 text-xs leading-5 text-text-secondary">ink-dream-memory 使用 Gateway Key 和模型 alias 调用：</p><ul className="mt-3 space-y-2 font-mono text-[10px] text-text-tertiary"><li>POST /v1/messages</li><li>POST /v1/messages/count_tokens</li><li>POST /v1/chat/completions</li><li>GET /v1/models</li></ul></section>;
}

export default function NewProviderPage() {
  return <AdminResourceFormPage mode="create" resource="providers" title="添加 Provider" eyebrow="Provider setup" description="每个 Provider 对应一个上游账号和一组运行配置。同一产品接入第二个账号时，请再创建一个 Provider。所有 Provider 都先停用创建；托管产品保存后进入账号连接页。" backHref="/admin/models/providers" fields={fields} sections={sections} defaults={{ adapterKind: "generic", protocol: "anthropic", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: "x-api-key", modelCatalogMode: "auto", manualModel: "", outputTokenParam: "max_tokens", config: {} }} presets={presets} submitLabel="添加 Provider" context={<ProviderContext />} />;
}
