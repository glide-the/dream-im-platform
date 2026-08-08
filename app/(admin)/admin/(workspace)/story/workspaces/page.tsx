import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryWorkspacesPage() {
  return <AdminModulePage eyebrow="Story operations / workspaces" title="工作区" description="直接读取 ink-memory 的 story_workspace_workspaces；详情包含所属用户、Story 数量和审计关系。" status="单库真实数据" tabs={storyTabs}><StoryResourceView kind="workspaces" /></AdminModulePage>;
}
