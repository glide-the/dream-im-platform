import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import { modelFields } from "@/components/admin/AdminResourceViews";

const sections = [
  { id: "relation", title: "Provider 关系" },
  { id: "identity", title: "模型 alias 与上游型号" },
  { id: "limits", title: "Token 上限" },
  { id: "capabilities", title: "模型能力" },
  { id: "status", title: "启用与影响" },
];

export default async function EditModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminResourceFormPage mode="edit" resource="models" recordId={id} title="模型设置" eyebrow="cc-switch · model settings" description="更新上游型号、能力、Token 上限和启用状态；稳定 alias 与 Provider 关系保持只读。" backHref="/admin/models/models" fields={modelFields} sections={sections} defaults={{ capabilities: {}, enabled: false }} submitLabel="保存模型设置" />;
}
