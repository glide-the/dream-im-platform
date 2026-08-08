import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import { PricingResourceView } from "@/components/admin/AdminResourceViews";

export default function PricingPage() {
  return <AdminModulePage eyebrow="AI supply chain / pricing" title="Pricing" description="采用 cc-switch 的全屏定价流程；金额为整数 micro-USD，任何调价都创建新版本。" status="版本化定价" tabs={modelTabs}><PricingResourceView /></AdminModulePage>;
}
