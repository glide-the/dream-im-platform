import AdminModulePage, { accessTabs } from "@/components/admin/AdminModulePage";
import { AdminRolesResourceView } from "@/components/admin/AdminResourceViews";

export default function RolesPage() {
  return <AdminModulePage eyebrow="Access governance / roles" title="角色" description="从真实权限资源构建最小权限矩阵；内置角色与使用中角色受服务端保护。" status="受保护关系" tabs={accessTabs}><AdminRolesResourceView /></AdminModulePage>;
}
