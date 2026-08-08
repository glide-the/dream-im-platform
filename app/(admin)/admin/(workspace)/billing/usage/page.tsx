import AdminModulePage, { billingTabs } from "@/components/admin/AdminModulePage";
import AdminUsageDashboard from "@/components/admin/AdminUsageDashboard";

export default function BillingUsagePage() {
  return <AdminModulePage eyebrow="Token billing / usage" title="使用记录" description="采用 cc-switch 的全局筛选、真实事实摘要、趋势、三统计页签和请求详情结构。" status="只读事实" tabs={billingTabs}><AdminUsageDashboard /></AdminModulePage>;
}
