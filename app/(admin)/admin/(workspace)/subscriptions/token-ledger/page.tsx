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
      <div className="space-y-6">
        <AdminResourceTable
          resource="subscription-token-grants"
          title="免费 Token 补发记录"
          description="管理员补发只增加当前周期 Bonus Token；记录不可更新或删除，并与订阅事件和 Admin Audit 交叉追溯。"
          filters={[
            { field: "email", label: "用户邮箱" },
            { field: "subscription_id", label: "订阅 ID", operator: "eq" },
          ]}
          columns={[
            { key: "id", label: "补发 ID" },
            { key: "email", label: "用户" },
            { key: "subscription_id", label: "订阅" },
            { key: "amount_tokens", label: "补发 Token" },
            { key: "bonus_before_tokens", label: "补发累计前" },
            { key: "bonus_after_tokens", label: "补发累计后" },
            { key: "available_before_tokens", label: "可用前" },
            { key: "available_after_tokens", label: "可用后" },
            { key: "reason", label: "原因" },
            { key: "actor_id", label: "操作人" },
            { key: "created_at", label: "时间", format: "date" },
          ]}
        />
        <AdminResourceTable
          resource="token-ledger"
          title="Gateway Token 使用流水"
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
      </div>
    </AdminModulePage>
  );
}
