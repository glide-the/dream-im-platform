import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import { ProvidersResourceView } from "@/components/admin/AdminResourceViews";

export default function ProvidersPage() {
  return <AdminModulePage eyebrow="AI supply chain / providers" title="Provider" description="采用 cc-switch 的全屏预设与分区设置流程；Credential 仅写入加密列，读取永不回显。" status="凭据加密" tabs={modelTabs}><ProvidersResourceView /></AdminModulePage>;
}
