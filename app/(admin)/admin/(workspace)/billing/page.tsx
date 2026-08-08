import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AdminBillingPage() {
  return (
    <div className="space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Billing ledger</p><h1 className="mt-2 font-display text-3xl font-semibold">Token 计费中心</h1><p className="mt-3 text-sm text-text-secondary">余额、预授权、实际费用和不可变账本使用统一 micro-USD 口径。</p></header>
      <AdminResourceTable resource="billing-accounts" title="Accounts" description="可用余额与进行中预授权分开记录。" defaultSort="updated_at" columns={[{ key: "platform_user_id", label: "用户 ID" }, { key: "email", label: "Email" }, { key: "available_microusd", label: "可用", format: "money" }, { key: "reserved_microusd", label: "预授权", format: "money" }, { key: "lifetime_debited_microusd", label: "累计扣款", format: "money" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
      <AdminResourceTable resource="usage" title="Usage" description="Input、Output 与缓存 Token 均保留原始维度。" columns={[{ key: "id", label: "Request" }, { key: "email", label: "用户" }, { key: "requested_model", label: "模型" }, { key: "input_tokens", label: "Input" }, { key: "output_tokens", label: "Output" }, { key: "cache_read_tokens", label: "Cache read" }, { key: "charged_microusd", label: "计费", format: "money" }, { key: "created_at", label: "时间", format: "date" }]} />
      <AdminResourceTable resource="ledger" title="Ledger" description="只追加；冲正通过新流水完成。" columns={[{ key: "id", label: "Ledger ID" }, { key: "email", label: "用户" }, { key: "entry_type", label: "类型", format: "status" }, { key: "amount_microusd", label: "金额", format: "money" }, { key: "available_after_microusd", label: "变更后可用", format: "money" }, { key: "description", label: "说明" }, { key: "created_at", label: "时间", format: "date" }]} />
    </div>
  );
}
