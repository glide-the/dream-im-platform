"use client";

import AdminResourceManager, {
  type AdminFieldDefinition,
} from "./AdminResourceManager";

const planStatus = [
  { label: "草稿", value: "draft" },
  { label: "启用", value: "active" },
  { label: "退役", value: "retired" },
];

export function SubscriptionPlansView() {
  const fields: AdminFieldDefinition[] = [
    { key: "code", label: "Code", control: "text", section: "identity", required: true, createOnly: true, readOnlyOnEdit: true },
    { key: "name", label: "套餐名称", control: "text", section: "identity", required: true },
    { key: "description", label: "说明", control: "textarea", section: "identity", nullable: true },
    { key: "currency", label: "币种", control: "hidden", section: "identity", createOnly: true },
    { key: "status", label: "状态", control: "select", section: "lifecycle", updateOnly: true, options: planStatus },
  ];
  return <AdminResourceManager resource="subscription-plans" title="订阅套餐" description="套餐只保存稳定身份；价格、周期、额度和超额策略由不可覆盖的 Plan Version 快照承载。" canDelete={false} container="drawer" createLabel="新建套餐" sections={[{ id: "identity", title: "套餐身份" }, { id: "lifecycle", title: "生命周期", description: "已有订阅的历史版本不受套餐退役影响。" }]} fields={fields} createDefaults={{ currency: "USD" }} filters={[{ field: "name", label: "名称或 Code" }, { field: "status", label: "状态", operator: "eq", options: planStatus }]} columns={[{ key: "code", label: "Code" }, { key: "name", label: "名称" }, { key: "currency", label: "币种" }, { key: "status", label: "状态", format: "status" }, { key: "version_count", label: "版本数" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
}

export function SubscriptionVersionsView() {
  const fields: AdminFieldDefinition[] = [
    { key: "planId", sourceKey: "plan_id", label: "套餐", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "subscription-plans", labelKey: "name", secondaryKey: "code", searchField: "name" } },
    { key: "billingPeriod", sourceKey: "billing_period", label: "周期", control: "select", section: "price", required: true, options: [{ label: "月付", value: "monthly" }, { label: "年付", value: "annual" }] },
    { key: "basePriceMicrousd", sourceKey: "base_price_microusd", label: "基础价格（USD）", control: "money", section: "price", required: true, min: 0 },
    { key: "trialDays", sourceKey: "trial_days", label: "试用天数", control: "number", section: "lifecycle", required: true, min: 0, max: 365 },
    { key: "gracePeriodDays", sourceKey: "grace_period_days", label: "宽限天数", control: "number", section: "lifecycle", required: true, min: 0, max: 90 },
    { key: "allowanceTokens", sourceKey: "allowance_tokens", label: "周期 Token 额度", control: "number", section: "allowance", required: true, min: 0 },
    { key: "allowanceMicrousd", sourceKey: "allowance_microusd", label: "周期金额额度（USD）", control: "money", section: "allowance", required: true, min: 0 },
    { key: "overagePolicy", sourceKey: "overage_policy", label: "超额策略", control: "select", section: "allowance", required: true, options: [{ label: "额度耗尽即拒绝", value: "deny" }, { label: "转余额计费", value: "cash_balance" }] },
    { key: "effectiveFrom", sourceKey: "effective_from", label: "生效时间", control: "datetime", section: "lifecycle", nullable: true },
  ];
  return <AdminResourceManager resource="subscription-plan-versions" title="套餐版本" description="发布后价格、权益和额度快照不可修改；后续调价必须创建下一版本。" canDelete={false} container="fullscreen" createLabel="创建版本草稿" submitUpdateLabel="保存草稿" sections={[{ id: "relation", title: "所属套餐" }, { id: "price", title: "周期与价格" }, { id: "allowance", title: "额度与超额" }, { id: "lifecycle", title: "试用、宽限与生效" }]} fields={fields} createDefaults={{ billingPeriod: "monthly", basePriceMicrousd: 0, trialDays: 0, gracePeriodDays: 0, allowanceTokens: 0, allowanceMicrousd: 0, overagePolicy: "deny", effectiveFrom: null }} filters={[{ field: "plan_code", label: "套餐 Code" }, { field: "status", label: "状态", operator: "eq", options: [{ label: "草稿", value: "draft" }, { label: "已发布", value: "published" }, { label: "退役", value: "retired" }] }]} commands={[{ action: "publish", label: "发布", description: "发布会冻结当前价格和权益快照。请在说明中记录发布依据。", requiresNotes: true, tone: "success", buildPayload: (_record, notes) => ({ effectiveFrom: new Date().toISOString(), idempotencyKey: `publish:${crypto.randomUUID()}`, reason: notes }) }]} columns={[{ key: "plan_code", label: "套餐" }, { key: "version_number", label: "版本" }, { key: "status", label: "状态", format: "status" }, { key: "billing_period", label: "周期" }, { key: "base_price_microusd", label: "基础价格", format: "money" }, { key: "allowance_tokens", label: "Token 额度" }, { key: "allowance_microusd", label: "金额额度", format: "money" }, { key: "overage_policy", label: "超额" }, { key: "entitlement_count", label: "权益数" }, { key: "published_at", label: "发布时间", format: "date" }]} />;
}

export function SubscriptionEntitlementsView() {
  const fields: AdminFieldDefinition[] = [
    { key: "planVersionId", sourceKey: "plan_version_id", label: "套餐版本", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "subscription-plan-versions", labelKey: "plan_code", secondaryKey: "version_number", searchField: "plan_code" } },
    { key: "modelId", sourceKey: "model_id", label: "模型", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "models", labelKey: "display_name", secondaryKey: "code", searchField: "display_name" } },
    { key: "gatewayScopes", sourceKey: "gateway_scopes", label: "Gateway Scopes", control: "multiselect", section: "access", required: true, options: [{ label: "Anthropic Messages", value: "messages:create" }, { label: "OpenAI Chat", value: "chat:create" }, { label: "Models List", value: "models:list" }] },
    { key: "requestsPerMinute", sourceKey: "requests_per_minute", label: "RPM", control: "number", section: "limits", nullable: true, min: 1 },
    { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "日 Token 上限", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "月 Token 上限", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "storageBytesLimit", sourceKey: "storage_bytes_limit", label: "Storage 字节上限", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "enabled", label: "启用权益", control: "switch", section: "access" },
  ];
  return <AdminResourceManager resource="subscription-entitlements" title="模型权益" description="每个版本按模型定义 Gateway Scope、RPM、Token 与 Storage 上限；发布版本的权益不可修改。" canDelete={false} container="drawer" createLabel="添加模型权益" sections={[{ id: "relation", title: "版本与模型" }, { id: "access", title: "调用范围" }, { id: "limits", title: "配额上限" }]} fields={fields} createDefaults={{ gatewayScopes: ["messages:create", "chat:create", "models:list"], requestsPerMinute: null, dailyTokenLimit: null, monthlyTokenLimit: null, storageBytesLimit: null, enabled: true }} filters={[{ field: "plan_code", label: "套餐" }, { field: "model_code", label: "模型" }, { field: "enabled", label: "启用", operator: "eq", options: [{ label: "启用", value: "true" }, { label: "停用", value: "false" }] }]} columns={[{ key: "plan_code", label: "套餐" }, { key: "version_number", label: "版本" }, { key: "model_code", label: "模型" }, { key: "gateway_scopes", label: "Scopes", format: "json" }, { key: "requests_per_minute", label: "RPM" }, { key: "daily_token_limit", label: "日 Token" }, { key: "monthly_token_limit", label: "月 Token" }, { key: "storage_bytes_limit", label: "Storage" }, { key: "enabled", label: "状态", format: "boolean" }]} />;
}
