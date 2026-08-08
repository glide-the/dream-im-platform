import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import { ModelPermissionsResourceView } from "@/components/admin/AdminResourceViews";

export default function ModelPermissionsPage() {
  return <AdminModulePage eyebrow="AI supply chain / permissions" title="模型权限" description="平台计费用户与模型之间的显式授权、RPM 和 Token 限额覆盖。" status="User → Model" tabs={modelTabs}><ModelPermissionsResourceView /></AdminModulePage>;
}
