import AdminModulePage, { billingTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function BillingLedgerPage() {
  return <AdminModulePage eyebrow="Token billing / immutable ledger" title="交易账本" description="账本只追加；更正与冲正通过新条目表达。每条记录保留变更前后可用与预授权余额。" status="禁止更新 / 删除" tabs={billingTabs}>
    <AdminResourceTable resource="ledger" title="不可变交易流水" description="通过 Gateway Request ID、用户、账户和条目类型追踪完整资金路径。" filters={[{ field: "email", label: "用户邮箱" }, { field: "gateway_request_id", label: "Gateway Request", operator: "eq" }, { field: "entry_type", label: "条目类型", operator: "eq" }, { field: "actor_type", label: "操作者类型", operator: "eq" }]} columns={[{ key: "id", label: "Ledger ID" }, { key: "email", label: "用户" }, { key: "gateway_request_id", label: "Gateway Request" }, { key: "entry_type", label: "类型", format: "status" }, { key: "amount_microusd", label: "金额", format: "money" }, { key: "available_before_microusd", label: "可用前", format: "money" }, { key: "available_after_microusd", label: "可用后", format: "money" }, { key: "description", label: "说明" }, { key: "created_at", label: "时间", format: "date" }]} />
  </AdminModulePage>;
}
