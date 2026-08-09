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
    { key: "status", label: "状态", control: "select", section: "lifecycle", updateOnly: true, options: planStatus },
  ];
  return <AdminResourceManager resource="subscription-plans" title="订阅套餐" description="套餐只保存稳定身份；不可覆盖的 Plan Version 定义每位用户个人订阅周期中的月度 Token 额度与模型权益，不包含金额。" canDelete={false} container="drawer" createLabel="新建套餐" sections={[{ id: "identity", title: "套餐身份" }, { id: "lifecycle", title: "生命周期", description: "退役只阻止后续选择，已有订阅继续保留其历史版本快照。" }]} fields={fields} filters={[{ field: "name", label: "名称或 Code" }, { field: "status", label: "状态", operator: "eq", options: planStatus }]} columns={[{ key: "code", label: "Code" }, { key: "name", label: "名称" }, { key: "status", label: "状态", format: "status" }, { key: "version_count", label: "版本数" }, { key: "updated_at", label: "更新时间", format: "date" }]} />;
}

export function SubscriptionVersionsView() {
  const fields: AdminFieldDefinition[] = [
    { key: "planId", sourceKey: "plan_id", label: "套餐", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "subscription-plans", labelKey: "name", secondaryKey: "code", searchField: "name" } },
    { key: "trialDays", sourceKey: "trial_days", label: "试用天数", control: "number", section: "lifecycle", required: true, min: 0, max: 365 },
    { key: "gracePeriodDays", sourceKey: "grace_period_days", label: "宽限天数", control: "number", section: "lifecycle", required: true, min: 0, max: 90 },
    { key: "allowanceTokens", sourceKey: "allowance_tokens", label: "每月 Token 额度", control: "number", section: "allowance", required: true, min: 1, help: "按每位用户自己的月度订阅周期发放；不是金额，也不按平台统一日期生效。" },
  ];
  return <AdminResourceManager resource="subscription-plan-versions" title="套餐版本" description="每个版本都是固定月度规则：只快照 Token 额度、试用/宽限参数与模型权益。发布后不可覆盖，且不设置平台统一生效日期。" canDelete={false} container="fullscreen" createLabel="创建版本草稿" submitUpdateLabel="保存草稿" sections={[{ id: "relation", title: "所属套餐", description: "周期固定为月度，并以每位用户的订阅周期锚点独立计算。" }, { id: "allowance", title: "月度 Token 额度", description: "额度只表示可调用 Token，不代表余额、赠款或任何币种金额。" }, { id: "lifecycle", title: "试用与宽限" }]} fields={fields} createDefaults={{ trialDays: 0, gracePeriodDays: 0, allowanceTokens: 1 }} filters={[{ field: "plan_code", label: "套餐 Code" }, { field: "status", label: "状态", operator: "eq", options: [{ label: "草稿", value: "draft" }, { label: "已发布", value: "published" }, { label: "退役", value: "retired" }] }]} commands={[{ action: "publish", label: "发布", description: "发布会冻结月度 Token 额度和权益快照；已订阅用户仍按个人周期边界应用版本。请记录发布依据。", requiresNotes: true, tone: "success", buildPayload: (_record, notes) => ({ idempotencyKey: `publish:${crypto.randomUUID()}`, reason: notes }) }]} columns={[{ key: "plan_code", label: "套餐" }, { key: "version_number", label: "版本" }, { key: "status", label: "状态", format: "status" }, { key: "allowance_tokens", label: "月度 Token" }, { key: "entitlement_count", label: "权益数" }, { key: "published_at", label: "发布时间", format: "date" }]} />;
}

export function SubscriptionEntitlementsView() {
  const fields: AdminFieldDefinition[] = [
    { key: "planVersionId", sourceKey: "plan_version_id", label: "套餐版本", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "subscription-plan-versions", labelKey: "plan_code", secondaryKey: "version_number", searchField: "plan_code" } },
    { key: "modelId", sourceKey: "model_id", label: "模型", control: "relation", section: "relation", required: true, createOnly: true, readOnlyOnEdit: true, relation: { resource: "models", labelKey: "display_name", secondaryKey: "code", searchField: "display_name" } },
    { key: "gatewayScopes", sourceKey: "gateway_scopes", label: "Gateway Scopes", control: "multiselect", section: "access", required: true, options: [{ label: "Anthropic Messages", value: "messages:create" }, { label: "OpenAI Chat", value: "chat:create" }, { label: "Models List", value: "models:list" }] },
    { key: "dailyTokenLimit", sourceKey: "daily_token_limit", label: "日 Token 上限", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "monthlyTokenLimit", sourceKey: "monthly_token_limit", label: "自然月 Token 安全上限（可选）", control: "number", section: "limits", nullable: true, min: 0, help: "独立于订阅周期 Allowance 的自然月安全阈值；留空表示不额外限制，不会发放 Token。" },
    { key: "storageBytesLimit", sourceKey: "storage_bytes_limit", label: "Storage 字节上限", control: "number", section: "limits", nullable: true, min: 0 },
    { key: "enabled", label: "启用权益", control: "switch", section: "access" },
  ];
  return <AdminResourceManager resource="subscription-entitlements" title="模型权益" description="每个版本按模型定义 Gateway Scope、独立安全阈值与 Storage 上限；发布版本的权益不可修改。套餐实际发放量只取 Plan Version 的月度 Token Allowance。" canDelete={false} container="drawer" createLabel="添加模型权益" sections={[{ id: "relation", title: "版本与模型" }, { id: "access", title: "调用范围" }, { id: "limits", title: "独立安全上限", description: "日/自然月上限用于风险控制，不发放额度，也不替代用户个人订阅周期中的 Token Allowance。" }]} fields={fields} createDefaults={{ gatewayScopes: ["messages:create", "chat:create", "models:list"], dailyTokenLimit: null, monthlyTokenLimit: null, storageBytesLimit: null, enabled: true }} filters={[{ field: "plan_code", label: "套餐" }, { field: "model_code", label: "模型" }, { field: "enabled", label: "启用", operator: "eq", options: [{ label: "启用", value: "true" }, { label: "停用", value: "false" }] }]} columns={[{ key: "plan_code", label: "套餐" }, { key: "version_number", label: "版本" }, { key: "model_code", label: "模型" }, { key: "gateway_scopes", label: "Scopes", format: "json" }, { key: "daily_token_limit", label: "日 Token 安全上限" }, { key: "monthly_token_limit", label: "自然月 Token 安全上限" }, { key: "storage_bytes_limit", label: "Storage" }, { key: "enabled", label: "状态", format: "boolean" }]} />;
}
