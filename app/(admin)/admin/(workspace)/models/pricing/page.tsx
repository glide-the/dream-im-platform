import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AIPricingTimeline from "@/components/admin/AIPricingTimeline";

export default function PricingPage() {
  return <AdminModulePage eyebrow="AI supply chain / pricing" title="Pricing" description="cc-switch 四类 Token 定价结构；金额为整数 micro-USD，任何调价都创建新版本。" status="版本化定价" tabs={modelTabs}><AIPricingTimeline /></AdminModulePage>;
}
