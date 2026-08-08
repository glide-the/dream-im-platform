import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import { providerFields } from "@/components/admin/AdminResourceViews";

const sections = [
  { id: "identity", title: "预设与基础信息", description: "先选择协议和稳定 Code；Code 创建后不可修改。" },
  { id: "connection", title: "Endpoint", description: "填写上游兼容入口，不把地址藏在 JSON 中。" },
  { id: "credential", title: "Credential", description: "Secret 只写入加密列；显隐只作用于本次草稿。" },
  { id: "runtime", title: "运行策略", description: "超时和重试共同决定代理失败边界。" },
  { id: "advanced", title: "高级配置", description: "已知键使用具名控件，只有未知扩展使用 JSON。" },
];

const presets = [
  { label: "Anthropic Official", description: "Anthropic 原生 Messages API。", values: { code: "anthropic-main", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "x-api-key", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "DeepSeek Anthropic", description: "DeepSeek Anthropic 兼容入口；凭据仍需本次安全输入。", values: { code: "deepseek-anthropic", name: "DeepSeek", protocol: "anthropic", baseUrl: "https://api.deepseek.com/anthropic", authMode: "bearer", outputTokenParam: "max_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "OpenAI Official", description: "OpenAI Chat Completions 入口。", values: { code: "openai-main", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com", authMode: "bearer", outputTokenParam: "max_completion_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
  { label: "自定义兼容端点", description: "自行填写协议、Endpoint 和凭据。", values: { code: "custom-provider", name: "Custom Provider", protocol: "openai", baseUrl: "https://example.com", authMode: "bearer", outputTokenParam: "max_completion_tokens", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: {} } },
];

function ProviderContext() {
  return <section className="rounded-2xl border border-border bg-bg-surface p-5"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Proxy publication</p><h2 className="mt-2 font-display text-lg font-semibold">对外代理</h2><p className="mt-2 text-xs leading-5 text-text-secondary">ink-dream-memory 使用 Gateway Key 和模型 alias 调用：</p><ul className="mt-3 space-y-2 font-mono text-[10px] text-text-tertiary"><li>POST /v1/messages</li><li>POST /v1/messages/count_tokens</li><li>POST /v1/chat/completions</li><li>GET /v1/models</li></ul></section>;
}

export default function NewProviderPage() {
  return <AdminResourceFormPage mode="create" resource="providers" title="添加 Provider" eyebrow="cc-switch · provider setup" description="按 cc-switch 的预设、基础信息、Credential、Endpoint 和高级配置顺序注册代理上游。创建后再配置稳定 Model alias 与价格版本。" backHref="/admin/models/providers" fields={providerFields} sections={sections} defaults={{ protocol: "anthropic", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: "x-api-key", outputTokenParam: "max_tokens", config: {} }} presets={presets} submitLabel="添加 Provider" context={<ProviderContext />} />;
}
