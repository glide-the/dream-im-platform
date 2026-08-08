import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import GatewayKeyForm from "@/components/admin/GatewayKeyForm";

export default function GatewayKeysPage() {
  return <AdminModulePage eyebrow="Proxy gateway / credentials" title="Gateway Key" description="为平台计费身份发放最小 Scope 密钥。明文只显示一次，后续仅可查看前缀、状态、过期与最近使用时间。" status="不可恢复" tabs={gatewayTabs}>
    <GatewayKeyForm />
    <AdminResourceTable resource="gateway-api-keys" title="Gateway Key 清单" description="密钥撤销使用状态迁移，禁止硬删除；详情不包含哈希或明文。" filters={[{ field: "email", label: "用户邮箱" }, { field: "name", label: "名称" }, { field: "key_prefix", label: "Key 前缀" }, { field: "status", label: "状态", operator: "eq" }]} columns={[{ key: "id", label: "Key ID" }, { key: "key_prefix", label: "前缀" }, { key: "email", label: "用户" }, { key: "name", label: "名称" }, { key: "scopes", label: "Scopes", format: "json" }, { key: "status", label: "状态", format: "status" }, { key: "expires_at", label: "过期时间", format: "date" }, { key: "last_used_at", label: "最近使用", format: "date" }]} />
  </AdminModulePage>;
}
