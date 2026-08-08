import BillingAdjustmentForm from "@/components/admin/BillingAdjustmentForm";
import AdminModulePage, { billingTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function BillingAccountsPage() {
  return <AdminModulePage eyebrow="Token billing / accounts" title="账户余额" description="可用余额、预授权和累计扣款分开保存。人工调整必须写入只追加账本，并记录原因、操作者和幂等键。" status="整数 micro-USD" tabs={billingTabs}>
    <BillingAdjustmentForm />
    <AdminResourceTable resource="billing-accounts" title="计费账户" description="账户余额是账本投影；version 用于并发控制。" defaultSort="updated_at" filters={[{ field: "email", label: "用户邮箱" }, { field: "tier", label: "用户层级", operator: "eq" }]} columns={[{ key: "id", label: "Account ID" }, { key: "platform_user_id", label: "Platform User" }, { key: "email", label: "用户" }, { key: "tier", label: "层级" }, { key: "available_microusd", label: "可用", format: "money" }, { key: "reserved_microusd", label: "预授权", format: "money" }, { key: "lifetime_debited_microusd", label: "累计扣款", format: "money" }, { key: "version", label: "Version" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
