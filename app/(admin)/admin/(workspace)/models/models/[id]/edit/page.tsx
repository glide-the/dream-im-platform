// [Input] Canonical model id and shared Admin model field definitions.
// [Output] Dedicated edit form with nullable Claude Code Runtime model settings.
// [Pos] AIModelRegistry edit route; stable alias/Provider remain immutable.
// [Sync] 2026-08-28: expose compact/context Runtime settings on the actual edit entry point.

import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import { modelFields } from "@/components/admin/AdminResourceViews";

const sections = [
  { id: "relation", title: "Provider 关系" },
  { id: "identity", title: "模型 alias 与上游型号" },
  { id: "limits", title: "Token 上限" },
  { id: "claude-runtime", title: "Claude Code Runtime", description: "仅作用于使用此模型的 Claude Agent turn；留空时不设置对应运行参数。" },
  { id: "capabilities", title: "模型能力" },
  { id: "status", title: "启用与影响" },
];

export default async function EditModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminResourceFormPage mode="edit" resource="models" recordId={id} title="模型设置" eyebrow="cc-switch · model settings" description="更新上游型号、能力、Token 上限、可选 Claude Code Runtime 配置和启用状态；稳定 alias 与 Provider 关系保持只读。" backHref="/admin/models/models" fields={modelFields} sections={sections} defaults={{ capabilities: {}, enabled: false, claudeCodeAutoCompactWindow: null, claudeCodeMaxContextTokens: null }} submitLabel="保存模型设置" />;
}
