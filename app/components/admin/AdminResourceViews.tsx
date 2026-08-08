"use client";

import AdminResourceManager, {
  type AdminFieldDefinition,
} from "./AdminResourceManager";

const stateOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
];

const providerFields: AdminFieldDefinition[] = [
  { key: "code", label: "Provider Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, placeholder: "anthropic-main", help: "稳定标识，创建后不可修改。" },
  { key: "protocol", label: "协议", control: "select", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] },
  { key: "name", label: "显示名称", control: "text", section: "identity", required: true },
  { key: "baseUrl", sourceKey: "base_url", label: "API Endpoint", control: "url", section: "connection", required: true, placeholder: "https://api.anthropic.com" },
  { key: "apiKey", label: "API Key / Credential", control: "password", section: "credential", omitEmptyOnUpdate: true, help: "已保存值永不回填；编辑时留空表示不轮换。" },
  { key: "authMode", label: "上游鉴权方式", control: "select", section: "credential", required: true, payloadGroup: { key: "config", property: "authMode" }, options: [{ label: "x-api-key（Anthropic 原生）", value: "x-api-key" }, { label: "Bearer Token（兼容中转）", value: "bearer" }] },
  { key: "status", label: "运行状态", control: "select", section: "runtime", required: true, options: stateOptions },
  { key: "timeoutMs", sourceKey: "timeout_ms", label: "超时（毫秒）", control: "number", section: "runtime", required: true, min: 1000, max: 900000, step: 1000 },
  { key: "maxRetries", sourceKey: "max_retries", label: "最大重试次数", control: "number", section: "runtime", required: true, min: 0, max: 5, step: 1 },
  { key: "outputTokenParam", label: "默认输出 Token 参数", control: "select", section: "advanced", required: true, payloadGroup: { key: "config", property: "outputTokenParam" }, options: [{ label: "max_tokens", value: "max_tokens" }, { label: "max_completion_tokens", value: "max_completion_tokens" }], help: "OpenAI 兼容请求未显式传参时使用；Anthropic 端点始终使用 max_tokens。" },
  { key: "config", label: "其他协议扩展配置", control: "json", section: "advanced", required: true, excludeKeys: ["authMode", "outputTokenParam"], help: "只有未被具名控件管理的真实扩展键放在这里；不得填写 Secret。" },
];

function ProviderProxyContract() {
  const endpoints = [
    { protocol: "Anthropic Messages", method: "POST", path: "/v1/messages", auth: "x-api-key: $INK_MEMORY_GATEWAY_KEY", scope: "messages:create" },
    { protocol: "Anthropic Token Count", method: "POST", path: "/v1/messages/count_tokens", auth: "x-api-key: $INK_MEMORY_GATEWAY_KEY", scope: "messages:create" },
    { protocol: "OpenAI Chat", method: "POST", path: "/v1/chat/completions", auth: "Authorization: Bearer $INK_MEMORY_GATEWAY_KEY", scope: "chat:create" },
    { protocol: "Model aliases", method: "GET", path: "/v1/models", auth: "Authorization: Bearer $INK_MEMORY_GATEWAY_KEY", scope: "models:list" },
  ];
  return <section className="admin-panel overflow-hidden"><header className="border-b border-border p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-tertiary">cc-switch style proxy publication</p><h2 className="mt-2 font-display text-xl font-semibold">Provider 对外代理契约</h2><p className="mt-2 text-sm leading-6 text-text-secondary">主要消费者为 <code className="font-mono text-xs text-text-primary">ink-dream-memory</code>。它只持有 Gateway Key 并调用稳定模型别名；Provider Secret、上游 Endpoint 和真实型号留在控制面。</p></div><span className="border border-success/35 bg-success-light px-3 py-1.5 text-xs font-semibold text-success">兼容 Anthropic / OpenAI</span></div></header><div className="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]"><div className="max-w-full overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-border bg-bg-secondary/45">{["协议", "方法", "代理路径", "外部鉴权", "所需 Scope"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</th>)}</tr></thead><tbody>{endpoints.map((endpoint) => <tr key={endpoint.path} className="border-b border-border last:border-0"><td className="px-4 py-3 font-semibold">{endpoint.protocol}</td><td className="px-4 py-3 font-mono text-xs">{endpoint.method}</td><td className="px-4 py-3 font-mono text-xs">{endpoint.path}</td><td className="px-4 py-3 font-mono text-[11px]">{endpoint.auth}</td><td className="px-4 py-3 font-mono text-[11px]">{endpoint.scope}</td></tr>)}</tbody></table></div><aside className="border-t border-border bg-bg-secondary/35 p-5 lg:border-l lg:border-t-0"><h3 className="font-display text-base font-semibold">可调用链</h3><ol className="mt-3 space-y-2 text-xs leading-5 text-text-secondary"><li>1. Provider active 且 Credential 已加密配置</li><li>2. Model alias enabled 并指向上游型号</li><li>3. 当前用户层级存在 active Pricing 版本</li><li>4. ink-dream 用户映射、模型权限、余额和限流通过</li><li>5. Gateway Key Scope 匹配协议</li></ol><div className="mt-5 flex flex-wrap gap-2"><a href="/admin/models/models" className="min-h-10 border border-border bg-bg-surface px-3 py-2 text-xs font-semibold">配置 Models</a><a href="/admin/models/pricing" className="min-h-10 border border-border bg-bg-surface px-3 py-2 text-xs font-semibold">配置 Pricing</a><a href="/admin/gateway/keys" className="min-h-10 bg-text-primary px-3 py-2 text-xs font-semibold text-bg-surface">发放 Gateway Key</a></div></aside></div></section>;
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

const upstreamModelOptions = [
  { label: "Anthropic · Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
  { label: "Anthropic · Claude Opus 4", value: "claude-opus-4-20250514" },
  { label: "Anthropic · Claude 3.7 Sonnet", value: "claude-3-7-sonnet-latest" },
  { label: "OpenAI · GPT-4.1", value: "gpt-4.1" },
  { label: "OpenAI · GPT-4.1 mini", value: "gpt-4.1-mini" },
  { label: "OpenAI · o3", value: "o3" },
];

const modelFields: AdminFieldDefinition[] = [
  { key: "providerId", sourceKey: "provider_id", label: "Provider", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "providers", labelKey: "name", secondaryKey: "code", searchField: "name" } },
  { key: "code", label: "模型别名 Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, placeholder: "claude-sonnet" },
  { key: "upstreamModel", sourceKey: "upstream_model", label: "上游型号（Model Dropdown）", control: "model-picker", section: "identity", required: true, placeholder: "选择常用型号或输入自定义型号", options: upstreamModelOptions },
  { key: "displayName", sourceKey: "display_name", label: "显示名称", control: "text", section: "identity", required: true },
  { key: "contextWindow", sourceKey: "context_window", label: "Context Window", control: "number", section: "limits", nullable: true, min: 1, step: 1 },
  { key: "maxOutputTokens", sourceKey: "max_output_tokens", label: "最大输出 Token", control: "number", section: "limits", nullable: true, min: 1, step: 1 },
  { key: "capabilities", label: "模型能力", control: "capabilities", section: "capabilities", options: [{ label: "对话", value: "chat" }, { label: "流式输出", value: "streaming" }, { label: "Tool Use", value: "tools" }, { label: "视觉输入", value: "vision" }, { label: "JSON 输出", value: "json" }] },
  { key: "enabled", label: "启用模型", control: "switch", section: "status", help: "Provider 未启用时，服务端会以 409/400 拒绝不安全启用。" },
];

export function ModelsResourceView() {
  return <AdminResourceManager resource="models" title="模型注册表" description="按 cc-switch 的 Provider → Model Dropdown → 高级能力流程配置；外部调用只看到稳定模型别名。" container="fullscreen" createLabel="新增模型" sections={[{ id: "relation", title: "Provider 关系", description: "从真实 Provider 注册表选择上游供应商。" }, { id: "identity", title: "模型别名与上游型号", description: "使用常用 Model Dropdown 或输入兼容端点实际支持的型号。" }, { id: "limits", title: "Token 上限" }, { id: "capabilities", title: "高级能力" }, { id: "status", title: "启用与影响", description: "启用模型后仍需 Provider、Pricing、用户权限、余额与 Gateway Key Scope 同时满足。" }]} fields={modelFields} createDefaults={{ enabled: false, capabilities: { chat: true, streaming: true }, contextWindow: null, maxOutputTokens: null }} filters={[{ field: "code", label: "模型别名" }, { field: "provider_code", label: "Provider", operator: "eq" }, { field: "enabled", label: "状态", operator: "eq", options: [{ label: "启用", value: "true" }, { label: "停用", value: "false" }] }]} columns={[{ key: "code", label: "模型别名" }, { key: "provider_code", label: "Provider" }, { key: "upstream_model", label: "上游型号" }, { key: "display_name", label: "显示名" }, { key: "context_window", label: "Context" }, { key: "max_output_tokens", label: "Max output" }, { key: "enabled", label: "状态", format: "boolean" }]} />;
}

const pricingFields: AdminFieldDefinition[] = [
  { key: "replacesPricingRuleId", label: "替换规则", control: "hidden", createOnly: true },
  { key: "modelId", sourceKey: "model_id", label: "模型", control: "relation", section: "relation", required: true, createOnly: true, relation: { resource: "models", labelKey: "display_name", secondaryKey: "code", searchField: "display_name" } },
  { key: "userTier", sourceKey: "user_tier", label: "用户层级", control: "text", section: "relation", required: true, createOnly: true, placeholder: "default" },
  { key: "inputPriceMicrousdPerMillion", sourceKey: "input_price_microusd_per_million", label: "Input（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "outputPriceMicrousdPerMillion", sourceKey: "output_price_microusd_per_million", label: "Output（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "cacheReadPriceMicrousdPerMillion", sourceKey: "cache_read_price_microusd_per_million", label: "Cache Read（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "cacheWritePriceMicrousdPerMillion", sourceKey: "cache_write_price_microusd_per_million", label: "Cache Write（USD / 1M tokens）", control: "money", section: "price", required: true, createOnly: true },
  { key: "markupBps", sourceKey: "markup_bps", label: "Markup（bps）", control: "number", section: "formula", required: true, min: 0, max: 100000, createOnly: true },
  { key: "discountBps", sourceKey: "discount_bps", label: "Discount（bps）", control: "number", section: "formula", required: true, min: 0, max: 10000, createOnly: true },
  { key: "effectiveFrom", sourceKey: "effective_from", label: "生效时间", control: "datetime", section: "window", required: true, createOnly: true },
  { key: "effectiveTo", sourceKey: "effective_to", label: "结束时间", control: "datetime", section: "window", nullable: true },
  { key: "status", label: "状态", control: "select", section: "window", required: true, options: stateOptions },
];

export function PricingResourceView() {
  return <AdminResourceManager resource="pricing-rules" title="定价时间线" description="采用 cc-switch Pricing 全屏骨架；历史金额不原地更新，调价创建新版本，旧版本只可关闭窗口或停用。" container="fullscreen" createLabel="新增定价" submitCreateLabel="创建价格版本" submitUpdateLabel="保存窗口状态" versionedCreate sections={[{ id: "relation", title: "模型与用户层级" }, { id: "price", title: "四类 Token 定价", description: "输入 USD / 1M tokens；提交时精确转换为整数 micro-USD。" }, { id: "formula", title: "计价公式" }, { id: "window", title: "生效窗口与状态" }]} fields={pricingFields} createDefaults={{ userTier: "default", inputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: new Date().toISOString(), effectiveTo: null }} defaultSort="effective_from" filters={[{ field: "model_code", label: "模型" }, { field: "user_tier", label: "用户层级", operator: "eq" }, { field: "status", label: "状态", operator: "eq", options: stateOptions }]} columns={[{ key: "model_code", label: "模型" }, { key: "user_tier", label: "用户层级" }, { key: "input_price_microusd_per_million", label: "Input", format: "money" }, { key: "output_price_microusd_per_million", label: "Output", format: "money" }, { key: "cache_read_price_microusd_per_million", label: "Cache read", format: "money" }, { key: "cache_write_price_microusd_per_million", label: "Cache write", format: "money" }, { key: "status", label: "状态", format: "status" }, { key: "effective_from", label: "生效时间", format: "date" }, { key: "effective_to", label: "结束时间", format: "date" }]} />;
}

const permissionFields: AdminFieldDefinition[] = [
  { key: "platformUserId", sourceKey: "platform_user_id", label: "计费用户", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "platform-users", labelKey: "email", secondaryKey: "display_name", searchField: "email" } },
  { key: "modelId", sourceKey: "model_id", label: "模型", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "models", labelKey: "display_name", secondaryKey: "code", searchField: "display_name" } },
  { key: "enabled", label: "允许调用", control: "switch", section: "policy" },
  { key: "requestsPerMinute", sourceKey: "requests_per_minute", label: "每分钟请求数", control: "number", section: "policy", nullable: true, min: 1 },
  { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "每日 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
  { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "每月 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
];

export function ModelPermissionsResourceView() {
  return <AdminResourceManager resource="user-model-permissions" title="用户—模型授权矩阵" description="关系从真实用户和模型选择；删除覆盖仅恢复默认策略，不影响历史窗口。" container="drawer" createLabel="新增模型授权" canDelete deleteLabel="删除覆盖" sections={[{ id: "relation", title: "用户与模型" }, { id: "policy", title: "调用策略" }, { id: "limits", title: "Token 限额" }]} fields={permissionFields} createDefaults={{ enabled: true, requestsPerMinute: null, dailyTokenLimit: null, monthlyTokenLimit: null }} defaultSort="updated_at" filters={[{ field: "email", label: "用户邮箱" }, { field: "model_code", label: "模型" }, { field: "enabled", label: "是否允许", operator: "eq", options: [{ label: "允许", value: "true" }, { label: "禁止", value: "false" }] }]} columns={[{ key: "email", label: "用户" }, { key: "model_code", label: "模型" }, { key: "enabled", label: "允许", format: "boolean" }, { key: "requests_per_minute", label: "RPM" }, { key: "daily_token_limit", label: "每日 Token" }, { key: "monthly_token_limit", label: "每月 Token" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
}

export function PlatformUsersResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "source", label: "来源", control: "select", section: "source", required: true, createOnly: true, readOnlyOnEdit: true, options: [{ label: "Ink Dream", value: "ink-dream" }] },
    { key: "externalUserId", sourceKey: "external_user_id", label: "源业务用户", control: "relation", section: "source", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "source-users", labelKey: "email", secondaryKey: "display_name", searchField: "email" } },
    { key: "email", label: "Email", control: "email", section: "profile", nullable: true },
    { key: "displayName", sourceKey: "display_name", label: "显示名称", control: "text", section: "profile", nullable: true },
    { key: "tier", label: "计费层级", control: "text", section: "billing", required: true },
    { key: "status", label: "状态", control: "select", section: "billing", required: true, options: [{ label: "启用", value: "active" }, { label: "暂停", value: "suspended" }, { label: "关闭", value: "closed" }] },
    { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "每日 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "每月 Token 限额", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "metadata", label: "扩展元数据", control: "json", section: "advanced" },
  ];
  return <AdminResourceManager resource="platform-users" title="计费用户映射" description="把源 users 主键映射为 Gateway 与计费身份，不复制或改写业务用户。" container="drawer" createLabel="初始化计费身份" sections={[{ id: "source", title: "真实业务用户" }, { id: "profile", title: "计费资料" }, { id: "billing", title: "套餐与状态" }, { id: "limits", title: "默认限额" }, { id: "advanced", title: "扩展元数据" }]} fields={fields} createDefaults={{ source: "ink-dream", tier: "free", status: "active", dailyTokenLimit: null, monthlyTokenLimit: null, metadata: {} }} filters={[{ field: "email", label: "Email" }, { field: "source", label: "来源", operator: "eq" }, { field: "tier", label: "套餐", operator: "eq" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "source", label: "来源" }, { key: "external_user_id", label: "源用户 ID" }, { key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "tier", label: "套餐" }, { key: "status", label: "状态", format: "status" }]} />;
}

export function AdminUsersResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "email", label: "Email", control: "email", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "displayName", sourceKey: "display_name", label: "显示名称", control: "text", section: "identity", nullable: true },
    { key: "password", label: "初始/新密码", control: "password", section: "security", requiredOnCreate: true, omitEmptyOnUpdate: true, help: "至少 14 字符；编辑留空表示不重置。" },
    { key: "status", label: "状态", control: "select", section: "security", updateOnly: true, options: stateOptions },
    { key: "roleCodes", sourceKey: "roles", label: "角色", control: "relation-multi", section: "roles", required: true, relation: { resource: "admin-roles", labelKey: "name", secondaryKey: "code", searchField: "name", valueKey: "code" } },
  ];
  return <AdminResourceManager resource="admin-users" title="管理员清单" description="管理员从真实记录进入编辑；最后一名 active super_admin 由服务端并发保护。" container="drawer" createLabel="新增管理员" sections={[{ id: "identity", title: "管理员身份" }, { id: "security", title: "状态与密码" }, { id: "roles", title: "角色分配" }]} fields={fields} createDefaults={{ roleCodes: [], status: "active" }} filters={[{ field: "email", label: "Email" }, { field: "status", label: "状态", operator: "eq", options: stateOptions }]} columns={[{ key: "email", label: "Email" }, { key: "display_name", label: "显示名" }, { key: "roles", label: "角色", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "last_login_at", label: "最近登录", format: "date" }]} />;
}

export function AdminRolesResourceView() {
  const fields: AdminFieldDefinition[] = [
    { key: "code", label: "Role Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "name", label: "名称", control: "text", section: "identity", required: true },
    { key: "description", label: "说明", control: "textarea", section: "identity", nullable: true },
    { key: "permissionCodes", sourceKey: "permissions", label: "权限矩阵", control: "relation-multi", section: "permissions", required: true, relation: { resource: "admin-permissions", labelKey: "name", secondaryKey: "code", searchField: "name", valueKey: "code" } },
  ];
  return <AdminResourceManager resource="admin-roles" title="角色—权限矩阵" description="权限来自真实 permission 资源；内置角色和仍在使用的角色由服务端保护。" container="fullscreen" createLabel="新增自定义角色" canDelete deleteLabel="删除自定义角色" sections={[{ id: "identity", title: "角色身份" }, { id: "permissions", title: "权限矩阵", description: "搜索并勾选最小权限集。" }]} fields={fields} createDefaults={{ permissionCodes: [] }} defaultSort="code" filters={[{ field: "code", label: "角色代码" }, { field: "name", label: "名称" }]} columns={[{ key: "code", label: "Role" }, { key: "name", label: "名称" }, { key: "description", label: "说明" }, { key: "permissions", label: "Permissions", format: "json" }]} />;
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
    { key: "platformUserId", sourceKey: "platform_user_id", label: "计费用户", control: "relation", section: "identity", required: true, relation: { resource: "platform-users", labelKey: "email", secondaryKey: "display_name", searchField: "email" } },
    { key: "name", label: "Key 名称", control: "text", section: "identity", required: true },
    { key: "scopes", label: "Scopes", control: "multiselect", section: "scope", required: true, options: [{ label: "Claude Messages", value: "messages:create" }, { label: "OpenAI Chat", value: "chat:create" }, { label: "模型列表", value: "models:list" }] },
    { key: "expiresAt", sourceKey: "expires_at", label: "过期时间", control: "datetime", section: "scope", nullable: true },
  ];
  return <AdminResourceManager resource="gateway-api-keys" title="Gateway Key 清单" description="创建回执只显示一次明文；后续只可查看前缀、Scope、状态并撤销。" container="modal" createLabel="发放 Gateway Key" submitCreateLabel="创建并显示一次" canEdit={false} canDelete deleteLabel="撤销 Key" sections={[{ id: "identity", title: "用户与名称" }, { id: "scope", title: "最小 Scope 与有效期" }]} fields={fields} createDefaults={{ scopes: ["messages:create", "chat:create", "models:list"], expiresAt: null }} filters={[{ field: "email", label: "用户邮箱" }, { field: "name", label: "名称" }, { field: "key_prefix", label: "Key 前缀" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "key_prefix", label: "前缀" }, { key: "email", label: "用户" }, { key: "name", label: "名称" }, { key: "scopes", label: "Scopes", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "expires_at", label: "过期时间", format: "date" }, { key: "last_used_at", label: "最近使用", format: "date" }]} />;
}

type StoryResourceViewProps = { kind: "workspaces" | "stories" | "characters" | "scenes" };

export function StoryResourceView({ kind }: StoryResourceViewProps) {
  if (kind === "workspaces") return <AdminResourceManager resource="story-workspaces" title="真实工作区" description="直接读取 story_workspace_workspaces；从真实行编辑名称或 settings。" canCreate={false} container="modal" fields={[{ key: "name", label: "工作区名称", control: "text", section: "main", required: true }, { key: "settings", label: "Workspace Settings", control: "json", section: "main", required: true }]} filters={[{ field: "name", label: "工作区" }, { field: "owner_email", label: "Owner Email" }]} columns={[{ key: "name", label: "工作区" }, { key: "owner_email", label: "Owner" }, { key: "owner_display_name", label: "显示名" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
  if (kind === "stories") return <AdminResourceManager resource="story-stories" title="真实剧本项目" description="正文与关系只读；允许更新标题、说明和类型，并通过具名命令审核/归档。" canCreate={false} container="drawer" fields={[{ key: "title", label: "标题", control: "text", section: "main", required: true }, { key: "description", label: "说明", control: "textarea", section: "main", nullable: true }, { key: "type", label: "类型", control: "select", section: "main", options: [{ label: "短篇", value: "short" }, { label: "长篇", value: "long" }, { label: "剧本", value: "script" }, { label: "大纲", value: "outline" }] }]} commands={[{ action: "confirm", label: "确认", description: "仅 Agent 生成、pending 且未归档的剧本可确认；相关 pending 场景与角色会按源项目规则确认。", tone: "success" }, { action: "reject", label: "拒绝", description: "拒绝会保留记录并写入审核说明。", requiresNotes: true, tone: "danger" }, { action: "archive", label: "归档", description: "归档替代硬删除；历史关系与审计保留。", tone: "danger" }]} filters={[{ field: "title", label: "标题" }, { field: "workspace_name", label: "工作区" }, { field: "review_status", label: "审核", operator: "eq" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "title", label: "剧本" }, { key: "workspace_name", label: "工作区" }, { key: "author_email", label: "作者" }, { key: "type", label: "类型" }, { key: "character_count", label: "角色" }, { key: "scene_count", label: "场景" }, { key: "review_status", label: "审核", format: "status" }, { key: "status", label: "状态", format: "status" }]} />;
  if (kind === "characters") return <AdminResourceManager resource="story-characters" title="真实角色" description="角色详情包含真实 Story role_type 与 Scene 关系；数组标签使用结构化逗号输入。" canCreate={false} container="drawer" fields={[{ key: "name", label: "名称", control: "text", section: "main", required: true }, { key: "identity", label: "身份", control: "textarea", section: "main", nullable: true }, { key: "personality", label: "性格", control: "textarea", section: "main", nullable: true }, { key: "background", label: "背景", control: "textarea", section: "main", nullable: true }, { key: "catchphrase", label: "口头禅", control: "textarea", section: "main", nullable: true }, { key: "tags", label: "标签", control: "tags", section: "main", help: "使用逗号分隔；提交为字符串数组。" }, { key: "avatarUrl", sourceKey: "avatar_url", label: "头像 URL", control: "url", section: "main", nullable: true }]} commands={[{ action: "confirm", label: "确认", description: "确认 pending Agent 角色。", tone: "success" }, { action: "reject", label: "拒绝", description: "拒绝并写入审核说明。", requiresNotes: true, tone: "danger" }, { action: "archive", label: "归档", description: "归档替代硬删除。", tone: "danger" }]} filters={[{ field: "name", label: "角色名" }, { field: "workspace_name", label: "工作区" }, { field: "review_status", label: "审核", operator: "eq" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "name", label: "角色" }, { key: "workspace_name", label: "工作区" }, { key: "story_count", label: "剧本数" }, { key: "review_status", label: "审核", format: "status" }, { key: "status", label: "状态", format: "status" }]} />;
  return <AdminResourceManager resource="story-scenes" title="真实场景" description="场景可绑定同作者/工作区 Story；详情包含 Story、Characters 与相邻场景。" canCreate={false} container="drawer" fields={[{ key: "name", label: "场景名", control: "text", section: "main", required: true }, { key: "description", label: "说明", control: "textarea", section: "main", nullable: true }, { key: "storyId", sourceKey: "story_id", label: "所属 Story", control: "relation", section: "main", nullable: true, relation: { resource: "story-stories", labelKey: "title", secondaryKey: "workspace_name", searchField: "title" } }, { key: "orderIndex", sourceKey: "order_index", label: "顺序", control: "number", section: "main", min: 0, required: true }]} commands={[{ action: "confirm", label: "确认", description: "确认 pending Agent 场景。", tone: "success" }, { action: "reject", label: "拒绝", description: "拒绝并写入审核说明。", requiresNotes: true, tone: "danger" }, { action: "archive", label: "归档", description: "归档替代硬删除。", tone: "danger" }]} filters={[{ field: "name", label: "场景名" }, { field: "story_title", label: "剧本" }, { field: "workspace_name", label: "工作区" }, { field: "review_status", label: "审核", operator: "eq" }]} columns={[{ key: "name", label: "场景" }, { key: "story_title", label: "剧本" }, { key: "workspace_name", label: "工作区" }, { key: "order_index", label: "顺序" }, { key: "review_status", label: "审核", format: "status" }, { key: "status", label: "状态", format: "status" }]} />;
}
