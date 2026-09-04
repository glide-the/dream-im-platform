// [Input] Provider form concepts and the shared Admin field-definition type.
// [Output] Server/client-neutral Provider state options and static/managed field declarations.
// [Pos] Shared Provider form metadata; importing it from Server Components must not cross a use-client boundary.
// [Sync] 2026-09-04: document collision-resistant managed preset codes while keeping shared fields server-safe.

import type { AdminFieldDefinition } from "./AdminResourceManager";

export const stateOptions = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
];

export const providerFields: AdminFieldDefinition[] = [
  { key: "expectedAuthRevision", sourceKey: "auth_revision", label: "认证配置版本", control: "hidden", section: "credential", updateOnly: true, serializeAs: "number", min: 1 },
  { key: "code", label: "Provider Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, placeholder: "anthropic-main", help: "稳定标识，创建后不可修改。托管产品预设会生成带随机 UUID 的可见 Code，你仍可在保存前调整。" },
  { key: "protocol", label: "协议", control: "select", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true, options: [{ label: "Anthropic", value: "anthropic" }, { label: "OpenAI", value: "openai" }] },
  { key: "name", label: "显示名称", control: "text", section: "identity", required: true },
  { key: "baseUrl", sourceKey: "base_url", label: "API Endpoint", control: "url", section: "connection", required: true, placeholder: "https://api.anthropic.com" },
  { key: "apiKey", label: "API Key / 静态凭据", control: "password", section: "credential", omitEmptyOnUpdate: true, help: "已保存值永不回填；编辑时留空表示不轮换。提交新凭据后会先验证，验证成功前继续使用当前有效凭据。" },
  { key: "authMode", label: "静态凭据发送方式", control: "select", section: "credential", required: true, payloadGroup: { key: "config", property: "authMode" }, options: [{ label: "x-api-key（Anthropic 原生静态 Key）", value: "x-api-key", when: { field: "protocol", equals: "anthropic" } }, { label: "Authorization: Bearer（静态凭据，非 OAuth）", value: "bearer" }], help: "OpenAI 协议只使用静态 Bearer；Anthropic 可选择原生 x-api-key 或兼容 Bearer。这里不代表 OAuth 登录或 Token 生命周期托管。" },
  { key: "status", label: "运行状态", control: "select", section: "runtime", required: true, options: stateOptions },
  { key: "timeoutMs", sourceKey: "timeout_ms", label: "超时（毫秒）", control: "number", section: "runtime", required: true, min: 1000, max: 900000, step: 1000 },
  { key: "maxRetries", sourceKey: "max_retries", label: "最大重试次数", control: "number", section: "runtime", required: true, min: 0, max: 5, step: 1 },
  { key: "modelCatalogMode", label: "模型目录模式", control: "select", section: "advanced", required: true, omitEmptyOnUpdate: true, payloadGroup: { key: "config", property: "modelCatalogMode" }, options: [{ label: "自动读取 /models", value: "auto" }, { label: "无 /models，手工配置", value: "manual" }], help: "没有模型目录接口时选择手工配置；保存 Provider 后直接进入添加模型，不发起目录探测。" },
  { key: "manualModel", label: "手工上游型号", control: "text", section: "advanced", omitEmptyOnUpdate: true, payloadGroup: { key: "config", property: "manualModel" }, placeholder: "hy3-preview", help: "手工模式必填；将预填到下一步 Model 的上游型号、alias 和显示名称。" },
  { key: "outputTokenParam", label: "默认输出 Token 参数", control: "select", section: "advanced", required: true, payloadGroup: { key: "config", property: "outputTokenParam" }, options: [{ label: "max_tokens", value: "max_tokens" }, { label: "max_completion_tokens", value: "max_completion_tokens" }], help: "OpenAI 兼容请求未显式传参时使用；Anthropic 端点始终使用 max_tokens。" },
  { key: "config", label: "其他协议扩展配置", control: "json", section: "advanced", required: true, excludeKeys: ["authMode", "modelCatalogMode", "manualModel", "outputTokenParam"], help: "只有未被具名控件管理的真实扩展键放在这里；不得填写 Secret。" },
];
