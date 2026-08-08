import AdminModulePage, { accessTabs } from "@/components/admin/AdminModulePage";
import { AdminUsersResourceView } from "@/components/admin/AdminResourceViews";

export default function AdminsPage() {
  return <AdminModulePage eyebrow="Access governance / administrators" title="管理员" description="服务端 Session、状态与角色共同决定访问；密码和哈希永不回显。" status="Session + RBAC" tabs={accessTabs}><AdminUsersResourceView /></AdminModulePage>;
}
