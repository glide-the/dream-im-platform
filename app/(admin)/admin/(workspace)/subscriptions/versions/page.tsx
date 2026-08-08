import AdminModulePage, { subscriptionTabs } from "@/components/admin/AdminModulePage";
import { SubscriptionVersionsView } from "@/components/admin/SubscriptionResourceViews";

export default function SubscriptionVersionsPage() {
  return <AdminModulePage eyebrow="Subscription billing / immutable versions" title="套餐版本" description="发布前配置价格与周期额度；发布动作冻结版本及其模型权益。" status="发布后不可覆盖" tabs={subscriptionTabs}><SubscriptionVersionsView /></AdminModulePage>;
}
