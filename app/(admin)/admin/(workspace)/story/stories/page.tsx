import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryStoriesPage() {
  return <AdminModulePage eyebrow="Story operations / stories" title="剧本" description="直接读取 ink-memory 的 canonical Story；正文与内部结构只读，运营更新严格维护 ID、状态和外键。" status="单库真实数据" tabs={storyTabs}><StoryResourceView kind="stories" /></AdminModulePage>;
}
