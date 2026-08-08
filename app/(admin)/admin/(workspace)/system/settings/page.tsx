import AdminModulePage, { systemTabs } from "@/components/admin/AdminModulePage";
import { SystemSettingsResourceView } from "@/components/admin/AdminResourceViews";

export default function SystemSettingsPage() {
  return <AdminModulePage eyebrow="System and audit / settings" title="系统设置" description="结构化运行参数使用受控 JSON；Secret 只允许覆盖，配置不提供硬删除。" status="Secret 脱敏" tabs={systemTabs}><SystemSettingsResourceView /></AdminModulePage>;
}
