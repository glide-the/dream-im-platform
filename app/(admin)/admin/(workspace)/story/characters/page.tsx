import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryCharactersPage() {
  return <AdminModulePage eyebrow="Story operations / characters" title="角色" description="直接读取真实角色与 Story role_type、Scene 桥接关系。" status="真实源表" tabs={storyTabs}><StoryResourceView kind="characters" /></AdminModulePage>;
}
