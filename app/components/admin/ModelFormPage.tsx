// [Sync] 2026-10-10: new Image models publish chat:false independently of generation/edit capabilities.
// [Input] Model route identity, query defaults, and shared Admin fields.
// [Output] Context-aware Image/text model form using existing audited writes.
// [Pos] Shared presentation; model validation and persistence remain server-owned.
// [Sync] 2026-10-10: retain independent center navigation without duplicating model management.
// [Sync] 2026-10-11: distinguish pre-call reservations from unknown complete image usage.

"use client";

import AdminResourceFormPage from "./AdminResourceFormPage";
import { modelFields } from "./AdminResourceViews";

const sections = [
  { id: "relation", title: "Provider 关系" },
  { id: "identity", title: "模型 alias 与上游型号" },
  { id: "limits", title: "Token 上限" },
  { id: "image-reservation", title: "图像 Token 预留", description: "预算用于调用前额度保护；完整用量未报告时保留“用量未知”状态，不按预留推算实际用量。依据记录可选。" },
  { id: "claude-runtime", title: "Claude Code Runtime", description: "留空时不设置对应运行参数。" },
  { id: "capabilities", title: "模型能力" },
  { id: "status", title: "启用与影响" },
];
export const imageModelFields = modelFields.map((field) => {
  if (field.key === "providerId" && field.relation) return {
    ...field, relation: { ...field.relation, filters: [{ field: "image_api_configured", operator: "eq" as const, value: "true" }] },
  };
  if (field.key === "upstreamModel") return { ...field, options: [] };
  if (field.key === "capabilities") return { ...field, options: field.options?.map((option) => ({ ...option, hidden: !["image_generation", "image_edit"].includes(option.value) })) };
  if (field.section === "limits" || field.section === "claude-runtime") return { ...field, section: "image-internal" };
  return field;
});

export default function ModelFormPage({ mode, recordId, imageMode = false, providerId = "", upstreamModel: requestedModel = "" }: {
  mode: "create" | "edit"; recordId?: string; imageMode?: boolean; providerId?: string; upstreamModel?: string;
}) {
  const creating = mode === "create";
  const upstreamModel = requestedModel.trim().slice(0, 200) || (imageMode ? "" : "deepseek-v4-pro");
  const code = upstreamModel.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || (imageMode ? "" : "custom-model");
  return <AdminResourceFormPage mode={mode} resource="models" recordId={recordId}
    title={imageMode ? creating ? "添加图像模型" : "图像模型设置" : creating ? "添加模型" : "模型设置"}
    eyebrow={imageMode ? "Image model center · Models" : "cc-switch · model settings"}
    description={imageMode ? "配置图像模型的 Provider、稳定别名、上游型号、生成与编辑能力及预留预算。参考依据可选，不影响平台价格的结算归属。" : "配置模型别名、上游型号、能力、Token 上限和可选 Claude Code Runtime；稳定别名与 Provider 创建后只读。"}
    backHref={imageMode ? "/admin/image-models/models" : "/admin/models/models"}
    fields={imageMode ? imageModelFields : modelFields} sections={imageMode ? sections.filter((section) => !["limits", "claude-runtime"].includes(section.id)) : sections}
    defaults={{ providerId, code, upstreamModel, displayName: upstreamModel, requestHeaders: {}, enabled: false,
      capabilities: creating ? imageMode ? { chat: false, image_generation: true, image_edit: true } : { chat: true, streaming: true } : {},
      contextWindow: null, maxOutputTokens: null, imageInputTokenReservePerImage: null, imageOutputTokenReservePerImage: null, imageReservationSource: null,
      claudeCodeAutoCompactWindow: null, claudeCodeMaxContextTokens: null }}
    submitLabel={creating ? imageMode ? "添加图像模型" : "添加模型" : "保存模型设置"} />;
}

