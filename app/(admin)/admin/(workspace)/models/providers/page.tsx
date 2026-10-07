import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AIProviderRegistry from "@/components/admin/AIProviderRegistry";

export default function ProvidersPage() {
  return <AdminModulePage eyebrow="AI supply chain / providers" title="Provider" description="管理上游连接、账户用量与可用模型。" status="代理供应链" tabs={modelTabs}><AIProviderRegistry /></AdminModulePage>;
}
// [Input] Protected Provider management navigation and server-authorized account projections.
// [Output] Provider registry with upstream account usage and connection management.
// [Pos] Provider page in the model supply workspace; routing has its own menu.
