import AdminModulePage, { subscriptionTabs } from "@/components/admin/AdminModulePage";
import SubscriptionLifecycleManager from "@/components/admin/SubscriptionLifecycleManager";

export default function UserSubscriptionsPage() {
  return <AdminModulePage eyebrow="Subscription billing / lifecycle" title="用户订阅" description="维护订阅生命周期与当前周期 Token Allowance；处理 402 时使用独立授权、幂等且全量审计的“补发本周期 Token”。" status="Allowance + Audited grants" tabs={subscriptionTabs}><SubscriptionLifecycleManager /></AdminModulePage>;
}
