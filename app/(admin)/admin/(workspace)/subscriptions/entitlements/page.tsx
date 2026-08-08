import AdminModulePage, { subscriptionTabs } from "@/components/admin/AdminModulePage";
import { SubscriptionEntitlementsView } from "@/components/admin/SubscriptionResourceViews";

export default function SubscriptionEntitlementsPage() {
  return <AdminModulePage eyebrow="Subscription billing / entitlements" title="套餐权益" description="把套餐版本绑定到真实 Model，限定协议 Scope、RPM、Token 和 Storage 配额。" status="Gateway 资格来源" tabs={subscriptionTabs}><SubscriptionEntitlementsView /></AdminModulePage>;
}
