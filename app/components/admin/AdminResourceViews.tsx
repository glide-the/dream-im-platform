"use client";

import AdminResourceManager, {
  type AdminFieldDefinition,
} from "./AdminResourceManager";
import GatewayKeyForm from "./GatewayKeyForm";
import StoryArtifactDetail from "./StoryArtifactDetail";

export const stateOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
];

const storyStatusOptions = [
  { label: "草稿", value: "draft" },
  { label: "已发布", value: "published" },
  { label: "已归档", value: "archived" },
];

const reviewStatusOptions = [
  { label: "待确认", value: "pending" },
  { label: "已确认", value: "confirmed" },
  { label: "已拒绝", value: "rejected" },
];

const workspaceStatusOptions = [
  { label: "活跃", value: "active" },
  { label: "已归档", value: "archived" },
];

export const providerFields: AdminFieldDefinition[] = [
  { key: "code", label: "Provider Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, placeholder: "anthropic-main", help: "稳定标识，创建后不可修改。" },
  { key: "protocol", label: "协议", control: "select", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] },
  { key: "name", label: "显示名称", control: "text", section: "identity", required: true },
  { key: "baseUrl", sourceKey: "base_url", label: "API Endpoint", control: "url", section: "connection", required: true, placeholder: "https://api.anthropic.com" },
  { key: "apiKey", label: "API Key / Credential", control: "password", section: "credential", omitEmptyOnUpdate: true, help: "已保存值永不回填；编辑时留空表示不轮换。" },
  { key: "authMode", label: "上游鉴权方式", control: "select", section: "credential", required: true, payloadGroup: { key: "config", property: "authMode" }, options: [{ label: "x-api-key（Anthropic 原生）", value: "x-api-key" }, { label: "Bearer Token（兼容中转）", value: "bearer" }] },
  { key: "status", label: "运行状态", control: "select", section: "runtime", required: true, options: stateOptions },
  { key: "timeoutMs", sourceKey: "timeout_ms", label: "超时（毫秒）", control: "number", section: "runtime", required: true, min: 1000, max: 900000, step: 1000 },
  { key: "maxRetries", sourceKey: "max_retries", label: "最大重试次数", control: "number", section: "runtime", required: true, min: 0, max: 5, step: 1 },
  { key: "modelCatalogMode", label: "模型目录模式", control: "select", section: "advanced", required: true, omitEmptyOnUpdate: true, payloadGroup: { key: "config", property: "modelCatalogMode" }, options: [{ label: "自动读取 /models", value: "auto" }, { label: "无 /models，手工配置", value: "manual" }], help: "没有模型目录接口时选择手工配置；保存 Provider 后直接进入添加模型，不发起目录探测。" },
  { key: "manualModel", label: "手工上游型号", control: "text", section: "advanced", omitEmptyOnUpdate: true, payloadGroup: { key: "config", property: "manualModel" }, placeholder: "hy3-preview", help: "手工模式必填；将预填到下一步 Model 的上游型号、alias 和显示名称。" },
  { key: "outputTokenParam", label: "默认输出 Token 参数", control: "select", section: "advanced", required: true, payloadGroup: { key: "config", property: "outputTokenParam" }, options: [{ label: "max_tokens", value: "max_tokens" }, { label: "max_completion_tokens", value: "max_completion_tokens" }], help: "OpenAI 兼容请求未显式传参时使用；Anthropic 端点始终使用 max_tokens。" },
  { key: "config", label: "其他协议扩展配置", control: "json", section: "advanced", required: true, excludeKeys: ["authMode", "modelCatalogMode", "manualModel", "outputTokenParam"], help: "只有未被具名控件管理的真实扩展键放在这里；不得填写 Secret。" },
];

export function ProviderProxyContract() {
  const endpoints = [
    { protocol: "Anthropic Messages", method: "POST", path: "/v1/messages", auth: "service key + subject JWT", scope: "messages:create" },
    { protocol: "Anthropic Token Count", method: "POST", path: "/v1/messages/count_tokens", auth: "service key + subject JWT", scope: "messages:create" },
    { protocol: "OpenAI Chat", method: "POST", path: "/v1/chat/completions", auth: "service key + subject JWT", scope: "chat:create" },
    { protocol: "Model aliases", method: "GET", path: "/v1/models", auth: "service key + subject JWT", scope: "models:list" },
  ];
  return <section className="admin-panel overflow-hidden"><header className="border-b border-border p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-tertiary">cc-switch style proxy publication</p><h2 className="mt-2 font-display text-xl font-semibold">Provider 对外代理契约</h2><p className="mt-2 text-sm leading-6 text-text-secondary">主要消费者为 <code className="font-mono text-xs text-text-primary">ink-dream-memory</code> 服务端。它持有 canonical-subject 服务 Key，为每个 canonical 用户签发短期 subject JWT，并只调用稳定模型别名；浏览器不持有服务 Key，Provider Secret、上游 Endpoint 和真实型号留在控制面。</p></div><span className="border border-success/35 bg-success-light px-3 py-1.5 text-xs font-semibold text-success">兼容 Anthropic / OpenAI</span></div></header><div className="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]"><div className="max-w-full overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-border bg-bg-secondary/45">{["协议", "方法", "代理路径", "服务端鉴权", "所需 Scope"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</th>)}</tr></thead><tbody>{endpoints.map((endpoint) => <tr key={endpoint.path} className="border-b border-border last:border-0"><td className="px-4 py-3 font-semibold">{endpoint.protocol}</td><td className="px-4 py-3 font-mono text-xs">{endpoint.method}</td><td className="px-4 py-3 font-mono text-xs">{endpoint.path}</td><td className="px-4 py-3 font-mono text-[11px]">{endpoint.auth}</td><td className="px-4 py-3 font-mono text-[11px]">{endpoint.scope}</td></tr>)}</tbody></table></div><aside className="border-t border-border bg-bg-secondary/35 p-5 lg:border-l lg:border-t-0"><h3 className="font-display text-base font-semibold">可调用链</h3><ol className="mt-3 space-y-2 text-xs leading-5 text-text-secondary"><li>1. canonical 用户与内部兼容投影存在且 active</li><li>2. 月度订阅、Entitlement 与 Model Permission 通过</li><li>3. RPM 与当前周期 Token Allowance 足够</li><li>4. Provider/Model active，Pricing 版本仅用于成本快照</li><li>5. 服务 Key、subject JWT 与 Scope 同时匹配</li></ol><div className="mt-5 flex flex-wrap gap-2"><a href="/admin/models/models" className="min-h-10 border border-border bg-bg-surface px-3 py-2 text-xs font-semibold">配置 Models</a><a href="/admin/models/pricing" className="min-h-10 border border-border bg-bg-surface px-3 py-2 text-xs font-semibold">配置 Pricing</a><a href="/admin/gateway/keys" className="min-h-10 bg-text-primary px-3 py-2 text-xs font-semibold text-bg-surface">发放服务 Key</a></div></aside></div></section>;
}

export function ProvidersResourceView() {
  return <div className="space-y-6"><ProviderProxyContract /><AdminResourceManager
    resource="providers"
    title="Provider 注册表"
    description="直接采用 cc-switch 的预设驱动全屏设置结构；凭据只写入加密列，读取仅显示配置状态与指纹。"
    container="fullscreen"
    createLabel="新增 Provider"
    submitCreateLabel="添加 Provider"
    submitUpdateLabel="保存 Provider"
    sections={[
      { id: "identity", title: "预设与基础信息", description: "先确定协议与稳定 Code，再填写运营名称。" },
      { id: "connection", title: "Endpoint", description: "Endpoint 使用明确 URL，不在 JSON 中隐藏。" },
      { id: "credential", title: "Credential", description: "显隐只作用于本次草稿；服务器不会返回历史明文。" },
      { id: "runtime", title: "运行策略" },
      { id: "advanced", title: "高级配置", description: "只有真实扩展对象使用 JSON Editor。" },
    ]}
    fields={providerFields}
    createDefaults={{ protocol: "anthropic", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: "x-api-key", outputTokenParam: "max_tokens", config: {} }}
    presets={[
      { label: "Anthropic Official", description: "Anthropic Messages API 默认 Endpoint。", values: { code: "anthropic-main", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: "x-api-key", outputTokenParam: "max_tokens", config: {} } },
      { label: "OpenAI Official", description: "OpenAI Chat Completions 兼容配置。", values: { code: "openai-main", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: "bearer", outputTokenParam: "max_completion_tokens", config: {} } },
      { label: "自定义兼容端点", description: "保留协议约束，自行填写 Endpoint 与凭据。", values: { code: "custom-provider", name: "Custom Provider", protocol: "openai", baseUrl: "https://example.com", status: "disabled", timeoutMs: 120000, maxRetries: 1, authMode: "bearer", outputTokenParam: "max_completion_tokens", config: {} } },
    ]}
    filters={[{ field: "name", label: "名称" }, { field: "protocol", label: "协议", operator: "eq", options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] }, { field: "status", label: "状态", operator: "eq", options: stateOptions }]}
    columns={[{ key: "code", label: "Code" }, { key: "name", label: "名称" }, { key: "protocol", label: "协议", format: "status" }, { key: "base_url", label: "Endpoint" }, { key: "status", label: "状态", format: "status" }, { key: "credential_configured", label: "凭据", format: "boolean" }, { key: "api_key_fingerprint", label: "指纹" }]}
  /></div>;
}

export const upstreamModelOptions = [
  { label: "DeepSeek · V4 Pro", value: "deepseek-v4-pro" },
  { label: "Anthropic · Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
  { label: "Anthropic · Claude Opus 4", value: "claude-opus-4-20250514" },
  { label: "Anthropic · Claude 3.7 Sonnet", value: "claude-3-7-sonnet-latest" },
  { label: "OpenAI · GPT-4.1", value: "gpt-4.1" },
  { label: "OpenAI · GPT-4.1 mini", value: "gpt-4.1-mini" },
  { label: "OpenAI · o3", value: "o3" },
];

export const modelFields: AdminFieldDefinition[] = [
  { key: "providerId", sourceKey: "provider_id", label: "Provider", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "providers", labelKey: "name", secondaryKey: "code", searchField: "name" } },
  { key: "code", label: "模型别名 Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, placeholder: "claude-sonnet" },
  { key: "upstreamModel", sourceKey: "upstream_model", label: "上游型号（Model Dropdown）", control: "model-picker", section: "identity", required: true, placeholder: "选择常用型号或输入自定义型号", options: upstreamModelOptions },
  { key: "displayName", sourceKey: "display_name", label: "显示名称", control: "text", section: "identity", required: true },
  { key: "requestHeaders", sourceKey: "request_headers", label: "上游差异请求头（JSON）", control: "json", jsonShape: "object", section: "identity", required: true, help: "仅用于当前模型，例如 {\"User-Agent\":\"OpenAI/JS 6.39.1\"}。不得填写 Authorization、x-api-key、Cookie、Host、Content-Type 或转发类请求头。" },
  { key: "contextWindow", sourceKey: "context_window", label: "Context Window", control: "number", section: "limits", nullable: true, min: 1, step: 1 },
  { key: "maxOutputTokens", sourceKey: "max_output_tokens", label: "最大输出 Token", control: "number", section: "limits", nullable: true, min: 1, step: 1 },
  { key: "capabilities", label: "模型能力", control: "capabilities", section: "capabilities", options: [{ label: "对话", value: "chat" }, { label: "流式输出", value: "streaming" }, { label: "Tool Use", value: "tools" }, { label: "视觉输入", value: "vision" }, { label: "JSON 输出", value: "json" }] },
  { key: "enabled", label: "启用模型", control: "switch", section: "status", help: "Provider 未启用时，服务端会以 409/400 拒绝不安全启用。" },
];

export function ModelsResourceView() {
  return <AdminResourceManager resource="models" title="模型注册表" description="按 cc-switch 的 Provider → Model Dropdown → 高级能力流程配置；外部调用只看到稳定模型别名。" container="fullscreen" createLabel="新增模型" sections={[{ id: "relation", title: "Provider 关系", description: "从真实 Provider 注册表选择上游供应商。" }, { id: "identity", title: "模型别名、上游型号与差异请求头", description: "使用常用 Model Dropdown 或输入兼容端点实际支持的型号；差异请求头只应用于当前模型。" }, { id: "limits", title: "Token 上限" }, { id: "capabilities", title: "高级能力" }, { id: "status", title: "启用与影响", description: "启用模型后仍需 Provider、Pricing 成本快照、订阅权益、模型权限、当前周期 Token Allowance 与 Gateway Scope 同时满足。" }]} fields={modelFields} createDefaults={{ enabled: false, capabilities: { chat: true, streaming: true }, requestHeaders: {}, contextWindow: null, maxOutputTokens: null }} filters={[{ field: "code", label: "模型别名" }, { field: "provider_code", label: "Provider", operator: "eq" }, { field: "enabled", label: "状态", operator: "eq", options: [{ label: "启用", value: "true" }, { label: "停用", value: "false" }] }]} columns={[{ key: "code", label: "模型别名" }, { key: "provider_code", label: "Provider" }, { key: "upstream_model", label: "上游型号" }, { key: "display_name", label: "显示名" }, { key: "context_window", label: "Context" }, { key: "max_output_tokens", label: "Max output" }, { key: "enabled", label: "状态", format: "boolean" }]} />;
}

export const pricingFields: AdminFieldDefinition[] = [
  { key: "replacesPricingRuleId", label: "替换规则", control: "hidden", createOnly: true },
  { key: "modelId", sourceKey: "model_id", label: "模型", control: "relation", section: "relation", required: true, createOnly: true, relation: { resource: "models", labelKey: "display_name", secondaryKey: "code", searchField: "display_name" } },
  { key: "userTier", sourceKey: "user_tier", label: "用户层级", control: "text", section: "relation", required: true, createOnly: true, placeholder: "default" },
  { key: "inputPriceMicrousdPerMillion", sourceKey: "input_price_microusd_per_million", label: "Input（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "outputPriceMicrousdPerMillion", sourceKey: "output_price_microusd_per_million", label: "Output（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "cacheReadPriceMicrousdPerMillion", sourceKey: "cache_read_price_microusd_per_million", label: "Cache Read（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "cacheWritePriceMicrousdPerMillion", sourceKey: "cache_write_price_microusd_per_million", label: "Cache Write（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "markupBps", sourceKey: "markup_bps", label: "Markup（%）", control: "percentage", section: "formula", required: true, min: 0, max: 1000, createOnly: true, help: "按百分比输入；下方实时显示精确 bps。" },
  { key: "discountBps", sourceKey: "discount_bps", label: "Discount（%）", control: "percentage", section: "formula", required: true, min: 0, max: 100, createOnly: true, help: "按百分比输入；下方实时显示精确 bps。" },
  { key: "effectiveFrom", sourceKey: "effective_from", label: "生效时间", control: "datetime", section: "window", required: true, createOnly: true },
  { key: "effectiveTo", sourceKey: "effective_to", label: "结束时间", control: "datetime", section: "window", nullable: true },
  { key: "status", label: "状态", control: "select", section: "window", required: true, options: stateOptions },
];

export function PricingResourceView() {
  return <AdminResourceManager resource="pricing-rules" title="定价时间线" description="采用 cc-switch Pricing 全屏骨架；历史金额不原地更新，调价创建新版本，旧版本只可关闭窗口或停用。" container="fullscreen" createLabel="新增定价" submitCreateLabel="创建价格版本" submitUpdateLabel="保存窗口状态" versionedCreate sections={[{ id: "relation", title: "模型与用户层级" }, { id: "price", title: "四类 Token 定价", description: "输入 USD / 1M tokens；提交时精确转换为整数 micro-USD。" }, { id: "formula", title: "计价公式" }, { id: "window", title: "生效窗口与状态" }]} fields={pricingFields} createDefaults={{ userTier: "default", inputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date().toISOString(), effectiveTo: null }} defaultSort="effective_from" filters={[{ field: "model_code", label: "模型" }, { field: "user_tier", label: "用户层级", operator: "eq" }, { field: "status", label: "状态", operator: "eq", options: stateOptions }]} columns={[{ key: "model_code", label: "模型" }, { key: "user_tier", label: "用户层级" }, { key: "input_price_microusd_per_million", label: "Input", format: "money" }, { key: "output_price_microusd_per_million", label: "Output", format: "money" }, { key: "cache_read_price_microusd_per_million", label: "Cache read", format: "money" }, { key: "cache_write_price_microusd_per_million", label: "Cache write", format: "money" }, { key: "status", label: "状态", format: "status" }, { key: "effective_from", label: "生效时间", format: "date" }, { key: "effective_to", label: "结束时间", format: "date" }]} />;
}

const permissionFields: AdminFieldDefinition[] = [
  { key: "platformUserId", sourceKey: "platform_user_id", label: "平台用户", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "platform-users", labelKey: "email", secondaryKey: "display_name", searchField: "email" } },
  { key: "modelId", sourceKey: "model_id", label: "模型", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "models", labelKey: "display_name", secondaryKey: "code", searchField: "display_name" } },
  { key: "enabled", label: "允许调用", control: "switch", section: "policy" },
  { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "每日 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
  { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "每月 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
];

export function ModelPermissionsResourceView() {
  return <AdminResourceManager resource="user-model-permissions" title="用户—模型例外限制" description="仅用于单独禁用或收紧特定用户对特定模型的 Token 上限；没有记录时沿用用户默认与套餐权益。删除覆盖只恢复默认策略，不影响历史窗口。请求频率策略暂不在 Admin 开放。" container="drawer" createLabel="新增例外限制" canDelete deleteLabel="删除覆盖" sections={[{ id: "relation", title: "用户与模型" }, { id: "policy", title: "调用策略" }, { id: "limits", title: "Token 限额" }]} fields={permissionFields} createDefaults={{ enabled: true, dailyTokenLimit: null, monthlyTokenLimit: null }} defaultSort="updated_at" filters={[{ field: "email", label: "用户邮箱" }, { field: "model_code", label: "模型" }, { field: "enabled", label: "是否允许", operator: "eq", options: [{ label: "允许", value: "true" }, { label: "禁止", value: "false" }] }]} columns={[{ key: "email", label: "用户" }, { key: "model_code", label: "模型" }, { key: "enabled", label: "允许", format: "boolean" }, { key: "daily_token_limit", label: "每日 Token" }, { key: "monthly_token_limit", label: "每月 Token" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
}

export function GatewayUserDefaultLimitsView() {
  const fields: AdminFieldDefinition[] = [
    { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "每日安全上限（429）", control: "number", section: "limits", nullable: true, min: 0, help: "只控制每日实时用量窗口；不会发放订阅 Token，也不能解除 402。" },
    { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "每月安全上限（429）", control: "number", section: "limits", nullable: true, min: 0, help: "只控制每月实时用量窗口；不会增加当前订阅周期余额。" },
  ];
  return <AdminResourceManager resource="platform-users" title="用户默认 429 Token 安全上限" description="这些字段只决定每日／每月实时用量达到何值时返回 429；不会发放免费或订阅 Token。SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED 是 402，必须在用户订阅中补发本周期 Token。" container="drawer" canCreate={false} canDelete={false} sections={[{ id: "limits", title: "429 用户安全上限", description: "保存后新请求按新安全上限检查；不会增加订阅 Allowance，也不会改写已经产生的实时用量。" }]} fields={fields} defaultSort="updated_at" filters={[{ field: "email", label: "用户邮箱" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "email", label: "用户" }, { key: "display_name", label: "显示名" }, { key: "tier", label: "层级" }, { key: "daily_token_limit", label: "每日安全上限（429）" }, { key: "monthly_token_limit", label: "每月安全上限（429）" }, { key: "updated_at", label: "更新时间", format: "date" }]} rowActions={[{ label: "处理 402／补发 Token", tone: "success", href: (row) => `/admin/subscriptions/users?email=${encodeURIComponent(String(row.email ?? ""))}&intent=grant#subscription-user-list` }]} />;
}

export function PlatformUsersResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "tier", label: "套餐层级", control: "text", section: "billing", required: true },
    { key: "status", label: "状态", control: "select", section: "billing", required: true, options: [{ label: "启用", value: "active" }, { label: "暂停", value: "suspended" }, { label: "关闭", value: "closed" }] },
    { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "每日 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "每月 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
  ];
  return <AdminResourceManager resource="platform-users" title="canonical 用户兼容投影" description="列表以 canonical users 全集为准；platform_users 只是内部兼容键，不是第二套用户名册。这里维护调用状态和默认 Token 上限，并显式暴露投影健康度。" container="drawer" canCreate={false} canDelete={false} sections={[{ id: "billing", title: "调用状态" }, { id: "limits", title: "默认限额" }]} fields={fields} filters={[{ field: "email", label: "Email" }, { field: "tier", label: "套餐", operator: "eq" }, { field: "status", label: "状态", operator: "eq" }, { field: "projection_ready", label: "兼容投影", operator: "eq", options: [{ label: "就绪", value: "true" }, { label: "缺失", value: "false" }] }, { field: "billing_account_ready", label: "现金账户投影", operator: "eq", options: [{ label: "就绪", value: "true" }, { label: "缺失", value: "false" }] }]} columns={[{ key: "external_user_id", label: "用户 ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "projection_ready", label: "兼容投影", format: "boolean" }, { key: "billing_account_ready", label: "现金账户", format: "boolean" }, { key: "tier", label: "套餐" }, { key: "status", label: "状态", format: "status" }]} />;
}

export function UsersResourceView() {
  return <AdminResourceManager
    resource="users"
    title="平台用户"
    description="只读查看 Dream 真实 users 与 Workspace、Story 关联；密码与会话字段不会返回到浏览器。"
    container="drawer"
    canCreate={false}
    canEdit={false}
    canDelete={false}
    fields={[]}
    defaultSort="updated_at"
    filters={[
      { field: "email", label: "邮箱或显示名" },
      { field: "role", label: "业务角色", operator: "eq" },
    ]}
    columns={[
      { key: "email", label: "Email" },
      { key: "display_name", label: "显示名" },
      { key: "role", label: "业务角色", format: "status" },
      { key: "workspace_count", label: "Workspace" },
      { key: "story_count", label: "Story" },
      { key: "updated_at", label: "更新时间", format: "date" },
    ]}
  />;
}

export function AdminUsersResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "email", label: "Email", control: "email", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "displayName", sourceKey: "display_name", label: "显示名称", control: "text", section: "identity", nullable: true },
    { key: "password", label: "初始/新密码", control: "password", section: "security", requiredOnCreate: true, omitEmptyOnUpdate: true, help: "至少 14 字符；编辑留空表示不重置。" },
    { key: "status", label: "状态", control: "select", section: "security", updateOnly: true, options: stateOptions },
    { key: "roleCodes", sourceKey: "roles", label: "角色", control: "relation-multi", section: "roles", required: true, relation: { resource: "roles", labelKey: "name", secondaryKey: "code", searchField: "name", valueKey: "code" } },
  ];
  return <AdminResourceManager resource="admin-users" title="管理员清单" description="管理员从真实记录进入编辑；最后一名 active super_admin 由服务端并发保护。" container="drawer" createLabel="新增管理员" sections={[{ id: "identity", title: "管理员身份" }, { id: "security", title: "状态与密码" }, { id: "roles", title: "角色分配" }]} fields={fields} createDefaults={{ roleCodes: [], status: "active" }} filters={[{ field: "email", label: "Email" }, { field: "status", label: "状态", operator: "eq", options: stateOptions }]} columns={[{ key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "roles", label: "角色", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "last_login_at", label: "最近登录", format: "date" }]} />;
}

export function AdminRolesResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "code", label: "Role Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "name", label: "名称", control: "text", section: "identity", required: true },
    { key: "description", label: "说明", control: "textarea", section: "identity", nullable: true },
    { key: "permissionCodes", sourceKey: "permissions", label: "权限矩阵", control: "relation-multi", section: "permissions", required: true, relation: { resource: "permissions", labelKey: "name", secondaryKey: "code", searchField: "name", valueKey: "code" } },
  ];
  return <AdminResourceManager resource="roles" title="角色—权限矩阵" description="权限来自真实 permission 资源；内置角色和仍在使用的角色由服务端保护。" container="fullscreen" createLabel="新增自定义角色" canDelete deleteLabel="删除自定义角色" sections={[{ id: "identity", title: "角色身份" }, { id: "permissions", title: "权限矩阵", description: "搜索并勾选最小权限集。" }]} fields={fields} createDefaults={{ permissionCodes: [] }} defaultSort="code" filters={[{ field: "code", label: "角色代码" }, { field: "name", label: "名称" }]} columns={[{ key: "code", label: "Role" }, { key: "name", label: "名称" }, { key: "description", label: "说明" }, { key: "permissions", label: "Permissions", format: "json" }]} />;
}

export function SystemSettingsResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "category", label: "分类", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "key", label: "配置键", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "description", label: "说明", control: "textarea", section: "identity", nullable: true },
    { key: "value", label: "JSON Value", control: "json", section: "value", required: true, help: "Secret 更新会覆盖旧值；历史值永不回填。" },
    { key: "isSecret", sourceKey: "is_secret", label: "敏感配置", control: "switch", section: "value", createOnly: true, readOnlyOnEdit: true },
    { key: "status", label: "状态", control: "select", section: "status", required: true, options: stateOptions },
  ];
  return <AdminResourceManager resource="system-settings" title="系统配置项" description="结构化设置使用 JSON Editor；Secret 只允许覆盖，系统设置不提供硬删除。" container="drawer" createLabel="新增设置" canDelete={false} sections={[{ id: "identity", title: "配置身份" }, { id: "value", title: "配置值与敏感性" }, { id: "status", title: "生命周期" }]} fields={fields} createDefaults={{ value: {}, isSecret: false, status: "active" }} defaultSort="updated_at" filters={[{ field: "category", label: "分类", operator: "eq" }, { field: "key", label: "键" }, { field: "is_secret", label: "敏感", operator: "eq", options: [{ label: "是", value: "true" }, { label: "否", value: "false" }] }, { field: "status", label: "状态", operator: "eq", options: stateOptions }]} columns={[{ key: "category", label: "分类" }, { key: "key", label: "键" }, { key: "value", label: "值", format: "json" }, { key: "is_secret", label: "敏感", format: "boolean" }, { key: "status", label: "状态", format: "status" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
}

export function GatewayKeysResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "subjectMode", sourceKey: "subject_mode", label: "主体模式", control: "hidden", section: "identity", required: true, createOnly: true },
    { key: "platformUserId", sourceKey: "platform_user_id", label: "平台用户", control: "relation", section: "identity", required: true, relation: { resource: "platform-users", labelKey: "email", secondaryKey: "display_name", searchField: "email" } },
    { key: "name", label: "Key 名称", control: "text", section: "identity", required: true },
    { key: "scopes", label: "Scopes", control: "multiselect", section: "scope", required: true, options: [{ label: "Claude Messages", value: "messages:create" }, { label: "OpenAI Chat", value: "chat:create" }, { label: "模型列表", value: "models:list" }] },
    { key: "expiresAt", sourceKey: "expires_at", label: "过期时间", control: "datetime", section: "scope", nullable: true },
  ];
  return <div className="space-y-6"><GatewayKeyForm /><AdminResourceManager resource="gateway-api-keys" title="Gateway Key 清单" description="固定用户 Key 仅用于 legacy/隔离调试；Dream 正式调用使用上方 canonical-subject 服务 Key。后续只可查看前缀、Scope、状态并撤销。" container="modal" createLabel="发放固定用户 Key" submitCreateLabel="创建并显示接入配置" canEdit={false} canDelete deleteLabel="撤销 Key" sections={[{ id: "identity", title: "用户与名称" }, { id: "scope", title: "最小 Scope 与有效期" }]} fields={fields} createDefaults={{ subjectMode: "fixed_user", scopes: ["messages:create", "chat:create", "models:list"], expiresAt: null }} filters={[{ field: "subject_mode", label: "主体模式", operator: "eq" }, { field: "email", label: "用户邮箱" }, { field: "name", label: "名称" }, { field: "key_prefix", label: "Key 前缀" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "key_prefix", label: "前缀" }, { key: "subject_mode", label: "主体模式" }, { key: "email", label: "用户" }, { key: "service_client_id", label: "服务 Client" }, { key: "name", label: "名称" }, { key: "scopes", label: "Scopes", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "expires_at", label: "过期时间", format: "date" }, { key: "last_used_at", label: "最近使用", format: "date" }]} /></div>;
}

type StoryResourceViewProps = { kind: "workspaces" | "stories" | "characters" | "scenes" };

export function StoryResourceView({ kind }: StoryResourceViewProps) {
  if (kind === "workspaces") {
    // Keep creation unavailable until Dream defines the object-storage-backed Workspace configuration contract.
    return <AdminResourceManager resource="story-workspaces" title="工作区" description="直接读取 Dream canonical Workspace；缺少计费映射或用户关系时保留主记录并显示诊断。" canCreate={false} canDelete={false} container="drawer" sections={[{ id: "main", title: "工作区信息" }]} fields={[{ key: "name", label: "工作区名称", control: "text", section: "main", required: true }, { key: "settings", label: "Workspace Settings", control: "json", section: "main", required: true }]} createDefaults={{ settings: {} }} defaultSort="updated_at" filters={[{ field: "name", label: "工作区名称" }, { field: "owner_id", label: "所属用户", operator: "eq", control: "relation", relation: { resource: "users", labelKey: "email", secondaryKey: "id", searchField: "email" } }, { field: "status", label: "状态", operator: "eq", control: "select", options: workspaceStatusOptions }, { field: "updated_from", apiField: "updated_at", label: "更新起始", operator: "gte", control: "datetime" }, { field: "updated_to", apiField: "updated_at", label: "更新截止", operator: "lte", control: "datetime" }]} columns={[{ key: "name", label: "工作区名称" }, { key: "id", label: "Workspace ID", format: "copy" }, { key: "owner_label", label: "所属用户" }, { key: "owner_id", label: "真实用户 ID", format: "copy" }, { key: "status", label: "状态", format: "status" }, { key: "billing_identity_bound", label: "计费映射", format: "binding" }, { key: "story_count", label: "剧本数量" }, { key: "created_at", label: "创建时间", format: "date" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
  }
  if (kind === "stories") return <AdminResourceManager resource="story-stories" title="剧本" description="列表只读 PostgreSQL canonical Story；详情从共享只读 Artifact 挂载按资源身份加载安全预览，文件异常不影响索引事实。" canCreate={false} canEdit={false} canDelete={false} container="drawer" fields={[]} renderDetail={(record) => <StoryArtifactDetail record={record} />} commands={[{ action: "confirm", label: "确认当前 Revision", description: "确认当前 PostgreSQL script revision；正文变化时服务端返回 409，不会审核旧文件。", tone: "success", buildPayload: (record) => ({ expectedScriptRevision: record.script_revision }) }]} defaultSort="updated_at" filters={[{ field: "title", label: "剧本标题" }, { field: "workspace_id", label: "所属工作区", operator: "eq", control: "relation", relation: { resource: "story-workspaces", labelKey: "name", secondaryKey: "id", searchField: "name" } }, { field: "author_id", label: "作者", operator: "eq", control: "relation", relation: { resource: "users", labelKey: "email", secondaryKey: "id", searchField: "email" } }, { field: "source_project_id", label: "Project identity" }, { field: "artifact_sync_status", label: "Artifact 状态", operator: "eq", control: "select", options: [{ label: "同步中", value: "syncing" }, { label: "已索引", value: "indexed" }, { label: "Revision 变化", value: "stale" }, { label: "文件缺失", value: "missing" }, { label: "同步失败", value: "failed" }] }, { field: "artifact_available", label: "Artifact 可用", operator: "eq", control: "select", options: [{ label: "可用", value: "true" }, { label: "不可用", value: "false" }] }, { field: "review_status", label: "审核状态", operator: "eq", control: "select", options: reviewStatusOptions }, { field: "status", label: "业务状态", operator: "eq", control: "select", options: storyStatusOptions }, { field: "updated_from", apiField: "updated_at", label: "更新起始", operator: "gte", control: "datetime" }, { field: "updated_to", apiField: "updated_at", label: "更新截止", operator: "lte", control: "datetime" }]} columns={[{ key: "title", label: "Story 标题" }, { key: "id", label: "Story ID", format: "copy" }, { key: "workspace_name", label: "Workspace" }, { key: "author_label", label: "作者" }, { key: "source_project_id", label: "Project identity" }, { key: "episode_count", label: "Episodes" }, { key: "artifact_sync_status", label: "Artifact 状态", format: "status" }, { key: "script_revision", label: "Script revision" }, { key: "artifact_indexed_at", label: "索引时间", format: "date" }, { key: "review_status", label: "审核状态", format: "status" }, { key: "status", label: "业务状态", format: "status" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
  if (kind === "characters") return <AdminResourceManager resource="story-characters" title="真实角色" description="角色详情包含真实 Story role_type 与 Scene 关系；当前审核操作仅保留确认。" canCreate={false} container="drawer" fields={[{ key: "name", label: "名称", control: "text", section: "main", required: true }, { key: "identity", label: "身份", control: "textarea", section: "main", nullable: true }, { key: "personality", label: "性格", control: "textarea", section: "main", nullable: true }, { key: "background", label: "背景", control: "textarea", section: "main", nullable: true }, { key: "catchphrase", label: "口头禅", control: "textarea", section: "main", nullable: true }, { key: "tags", label: "标签", control: "tags", section: "main", help: "使用逗号分隔；提交为字符串数组。" }, { key: "avatarUrl", sourceKey: "avatar_url", label: "头像 URL", control: "url", section: "main", nullable: true }]} commands={[{ action: "confirm", label: "确认", description: "确认 pending Agent 角色。", tone: "success" }]} filters={[{ field: "name", label: "角色名" }, { field: "workspace_name", label: "工作区" }, { field: "review_status", label: "审核", operator: "eq", options: reviewStatusOptions }]} columns={[{ key: "name", label: "角色" }, { key: "workspace_name", label: "工作区" }, { key: "story_count", label: "剧本数" }, { key: "review_status", label: "审核", format: "status" }]} />;
  return <AdminResourceManager resource="story-scenes" title="真实场景" description="场景可绑定同作者/工作区 Story；当前审核操作仅保留确认。" canCreate={false} container="drawer" fields={[{ key: "name", label: "场景名", control: "text", section: "main", required: true }, { key: "description", label: "说明", control: "textarea", section: "main", nullable: true }, { key: "storyId", sourceKey: "story_id", label: "所属 Story", control: "relation", section: "main", nullable: true, relation: { resource: "story-stories", labelKey: "title", secondaryKey: "workspace_name", searchField: "title" } }, { key: "orderIndex", sourceKey: "order_index", label: "顺序", control: "number", section: "main", min: 0, required: true }]} commands={[{ action: "confirm", label: "确认", description: "确认 pending Agent 场景。", tone: "success" }]} filters={[{ field: "name", label: "场景名" }, { field: "story_title", label: "剧本" }, { field: "workspace_name", label: "工作区" }, { field: "review_status", label: "审核", operator: "eq", options: reviewStatusOptions }]} columns={[{ key: "name", label: "场景" }, { key: "story_title", label: "剧本" }, { key: "workspace_name", label: "工作区" }, { key: "order_index", label: "顺序" }, { key: "review_status", label: "审核", format: "status" }]} />;
}
