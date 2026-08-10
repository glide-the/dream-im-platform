import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryStoriesPage() {
  return <AdminModulePage eyebrow="Story operations / stories" title="剧本" description="PostgreSQL 提供 canonical Story 索引；详情从共享只读挂载按资源身份读取 Artifact，不暴露真实路径。" status="索引 / Artifact 双轨" tabs={storyTabs}><StoryResourceView kind="stories" /></AdminModulePage>;
}
