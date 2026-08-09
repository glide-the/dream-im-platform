import AdminModulePage, {
  subscriptionTabs,
} from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function SubscriptionTokenLedgerPage() {
  return (
    <AdminModulePage
      eyebrow="Token-only subscription / append-only ledger"
      title="Token 流水"
      description="按 Gateway 请求展示周期 Token 的预留、结算与释放。该流水不代表金额、付款或第三方账单。"
      status="只读 / 禁止更新与删除"
      tabs={subscriptionTabs}
    >
      <AdminResourceTable
        resource="token-ledger"
        title="不可变 Token 流水"
        description="每条记录保存 Token 状态前后快照，并可追溯到用户、订阅、套餐版本、周期额度和 Gateway Request。"
        filters={[
          { field: "email", label: "用户邮箱" },
          {
            field: "gateway_request_id",
            label: "Gateway Request",
            operator: "eq",
          },
          { field: "entry_type", label: "类型", operator: "eq" },
        ]}
        columns={[
          { key: "id", label: "流水 ID" },
          { key: "email", label: "用户" },
          { key: "gateway_request_id", label: "Gateway Request" },
          { key: "request_sequence", label: "请求内顺序" },
          { key: "entry_type", label: "类型", format: "status" },
          { key: "amount_tokens", label: "Token 数" },
          { key: "available_before_tokens", label: "可用前" },
          { key: "available_after_tokens", label: "可用后" },
          { key: "reserved_after_tokens", label: "预留后" },
          { key: "consumed_after_tokens", label: "已用后" },
          { key: "created_at", label: "时间", format: "date" },
        ]}
      />
    </AdminModulePage>
  );
}
