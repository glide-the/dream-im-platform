import AdminModulePage, { userResourceTabs } from "@/components/admin/AdminModulePage";
import { UsersResourceView } from "@/components/admin/AdminResourceViews";

export default function UsersPage() {
  return <AdminModulePage eyebrow="User center / platform users" title="平台用户" description="查看 ink-memory 的真实业务用户、状态与 Workspace／Story 关联，不暴露密码、Token 或 Session。" status="单库真实数据" tabs={userResourceTabs}>
    <UsersResourceView />
  </AdminModulePage>;
}
