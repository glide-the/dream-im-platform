import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import StorySourceEditor from "@/components/admin/StorySourceEditor";

export default function StoryWorkspacesPage() {
  return <AdminModulePage eyebrow="Story source / workspaces" title="工作区" description="直接读取 story_workspace_workspaces，并以源 users.owner_id 保持所有权关系。工作区由业务端创建，Admin 只维护源契约允许的名称与设置。" status="真实业务表" tabs={storyTabs}>
    <StorySourceEditor resource="story-workspaces" title="工作区允许修改项" description="仅 PATCH name / settings；不在控制台创建或删除工作区。" fields={[{ key: "name", label: "工作区名称" }, { key: "settings", label: "工作区设置", type: "json" }]} />
    <AdminResourceTable resource="story-workspaces" title="业务工作区" description="真实工作区、所有者与更新时间；点击“查看”检查完整字段。" defaultSort="updated_at" filters={[{ field: "name", label: "名称" }, { field: "owner_email", label: "所有者邮箱" }]} columns={[{ key: "id", label: "Workspace ID" }, { key: "name", label: "名称" }, { key: "owner_email", label: "所有者" }, { key: "owner_id", label: "源用户 ID" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
