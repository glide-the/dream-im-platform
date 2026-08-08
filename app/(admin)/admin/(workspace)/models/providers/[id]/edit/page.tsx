import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import { providerFields } from "@/components/admin/AdminResourceViews";

const sections = [
  { id: "identity", title: "Provider 身份", description: "Code 与协议只读；如需更换协议，请新建 Provider。" },
  { id: "connection", title: "Endpoint" },
  { id: "credential", title: "Credential 轮换", description: "留空表示保留现有密钥；历史明文永不回填。" },
  { id: "runtime", title: "运行与启停" },
  { id: "advanced", title: "高级配置" },
];

export default async function EditProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminResourceFormPage mode="edit" resource="providers" recordId={id} title="编辑 Provider" eyebrow="cc-switch · provider settings" description="修改 Endpoint、运行策略或轮换凭据。保存后代理请求立即按新配置解析，但历史请求和计费快照不会变化。" backHref="/admin/models/providers" fields={providerFields} sections={sections} defaults={{ authMode: "x-api-key", outputTokenParam: "max_tokens", config: {} }} submitLabel="保存 Provider" />;
}
