import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import { modelFields } from "@/components/admin/AdminResourceViews";

const sections = [
  { id: "relation", title: "Provider 关系", description: "从真实 Provider 注册表选择上游。" },
  { id: "identity", title: "模型 alias 与上游型号", description: "外部只看到 alias；上游型号使用 Model Dropdown 或受控自定义输入。" },
  { id: "limits", title: "Token 上限" },
  { id: "capabilities", title: "模型能力" },
  { id: "status", title: "启用与影响" },
];

export default async function NewModelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const providerId = typeof query.providerId === "string" ? query.providerId : "";
  const upstreamModel = typeof query.upstreamModel === "string" && query.upstreamModel.trim()
    ? query.upstreamModel.trim().slice(0, 200)
    : "deepseek-v4-pro";
  const suggestedCode = upstreamModel
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "custom-model";
  return <AdminResourceFormPage mode="create" resource="models" title="添加模型" eyebrow="cc-switch · model settings" description="为 Provider 注册稳定模型 alias、上游型号、能力和 Token 上限。启用后仍需要有效 Pricing、用户权限、余额和 Gateway Key scope。" backHref="/admin/models/models" fields={modelFields} sections={sections} defaults={{ providerId, code: suggestedCode, upstreamModel, displayName: upstreamModel, enabled: false, capabilities: { chat: true, streaming: true }, contextWindow: null, maxOutputTokens: null }} submitLabel="添加模型" />;
}
