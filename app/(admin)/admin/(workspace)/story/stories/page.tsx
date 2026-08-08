import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryStoriesPage() {
  return <AdminModulePage eyebrow="Story operations / stories" title="剧本项目" description="真实 Story 正文与关系只读；更新与审核严格维护源 ID、状态和外键。" status="真实源表" tabs={storyTabs}><StoryResourceView kind="stories" /></AdminModulePage>;
}
