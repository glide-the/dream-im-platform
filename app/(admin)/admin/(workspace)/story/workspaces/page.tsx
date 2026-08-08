import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryWorkspacesPage() {
  return <AdminModulePage eyebrow="Story operations / workspaces" title="工作区" description="直接读取真实 story_workspace_workspaces；详情包含真实领域计数。" status="真实源表" tabs={storyTabs}><StoryResourceView kind="workspaces" /></AdminModulePage>;
}
