import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import { GatewayKeysResourceView } from "@/components/admin/AdminResourceViews";

export default function GatewayKeysPage() {
  return <AdminModulePage eyebrow="Proxy gateway / credentials" title="Gateway Key" description="真实用户关系、最小 Scope、一次性明文回执与可审计撤销。" status="不可恢复" tabs={gatewayTabs}><GatewayKeysResourceView /></AdminModulePage>;
}
