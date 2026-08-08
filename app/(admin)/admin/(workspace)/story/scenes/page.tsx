import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryScenesPage() {
  return <AdminModulePage eyebrow="Story operations / scenes" title="场景" description="真实场景关系到 Story、Characters 和相邻场景；绑定时校验同作者与工作区。" status="真实源表" tabs={storyTabs}><StoryResourceView kind="scenes" /></AdminModulePage>;
}
