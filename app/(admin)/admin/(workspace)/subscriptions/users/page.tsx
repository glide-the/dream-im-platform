import AdminModulePage, { subscriptionTabs } from "@/components/admin/AdminModulePage";
import SubscriptionLifecycleManager from "@/components/admin/SubscriptionLifecycleManager";

export default function UserSubscriptionsPage() {
  return <AdminModulePage eyebrow="Subscription billing / lifecycle" title="用户订阅" description="开通、续费、升级、降级、暂停、恢复与期末取消均使用显式命令、幂等键、事务和只追加事件。" status="Allowance + Balance" tabs={subscriptionTabs}><SubscriptionLifecycleManager /></AdminModulePage>;
}
