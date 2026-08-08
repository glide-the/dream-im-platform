import AdminModulePage, { gatewayTabs } from "@/components/admin/AdminModulePage";
import { GatewayKeysResourceView } from "@/components/admin/AdminResourceViews";

export default function GatewayKeysPage() {
  return <AdminModulePage eyebrow="Proxy gateway / credentials" title="Gateway Key" description="创建后一次性显示网关地址、ANTHROPIC_BASE_URL 与 ANTHROPIC_AUTH_TOKEN；关闭后只保留前缀。" status="一次性接入配置" tabs={gatewayTabs}><GatewayKeysResourceView /></AdminModulePage>;
}
