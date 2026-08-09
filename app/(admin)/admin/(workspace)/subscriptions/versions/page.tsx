import AdminModulePage, { subscriptionTabs } from "@/components/admin/AdminModulePage";
import { SubscriptionVersionsView } from "@/components/admin/SubscriptionResourceViews";

export default function SubscriptionVersionsPage() {
  return <AdminModulePage eyebrow="Subscription / monthly token versions" title="套餐版本" description="发布前配置月度 Token 额度、试用／宽限参数与模型权益；发布后不可覆盖。" status="发布后不可覆盖" tabs={subscriptionTabs}><SubscriptionVersionsView /></AdminModulePage>;
}
