import AdminModulePage, { billingTabs } from "@/components/admin/AdminModulePage";
import BillingReport from "@/components/admin/BillingReport";

export default function BillingReportsPage() {
  return <AdminModulePage eyebrow="Token billing / reports" title="计费报表" description="按日汇总真实请求、Token、Provider 成本、用户收费与结算失败记录；支持在浏览器导出当前范围 CSV。" status="可追溯汇总" tabs={billingTabs}><BillingReport /></AdminModulePage>;
}
