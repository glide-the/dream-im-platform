import AdminModulePage, { subscriptionTabs } from "@/components/admin/AdminModulePage";
import { SubscriptionPlansView } from "@/components/admin/SubscriptionResourceViews";

export default function SubscriptionPlansPage() {
  return <AdminModulePage eyebrow="Subscription billing / plans" title="订阅套餐" description="稳定套餐身份与可发布的价格、额度和权益版本分离；历史订阅始终引用原始快照。" status="PostgreSQL 真实数据" tabs={subscriptionTabs}><SubscriptionPlansView /></AdminModulePage>;
}
