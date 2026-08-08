import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import StorySourceEditor from "@/components/admin/StorySourceEditor";

export default function StoryCharactersPage() {
  return <AdminModulePage eyebrow="Story source / characters" title="角色" description="角色是工作区级实体，通过 story_workspace_story_characters 与剧本形成多对多关系，不再错误绑定单一 project_id。" status="M:N 关系" tabs={storyTabs}>
    <StorySourceEditor resource="story-characters" title="角色编辑与审核" description="仅维护源 Patch 契约允许的角色描述字段；关联关系和 story_count 由业务端流程维护。" reviewActions fields={[{ key: "name", label: "角色名" }, { key: "identity", label: "身份", type: "textarea" }, { key: "personality", label: "性格", type: "textarea" }, { key: "background", label: "背景", type: "textarea" }, { key: "catchphrase", label: "口头禅", type: "textarea" }, { key: "tags", label: "标签数组", type: "json" }, { key: "avatarUrl", label: "头像 URL" }]} />
    <AdminResourceTable resource="story-characters" title="真实角色" description="角色归属于作者与工作区，可被多个剧本引用。" defaultSort="updated_at" filters={[{ field: "name", label: "角色名" }, { field: "workspace_id", label: "Workspace ID", operator: "eq" }, { field: "review_status", label: "审核状态", operator: "eq", options: [{ label: "待审核", value: "pending" }, { label: "已确认", value: "confirmed" }, { label: "已拒绝", value: "rejected" }] }, { field: "status", label: "状态", operator: "eq", options: [{ label: "使用中", value: "active" }, { label: "已归档", value: "archived" }] }]} columns={[{ key: "id", label: "Character ID" }, { key: "name", label: "角色" }, { key: "workspace_name", label: "工作区" }, { key: "author_email", label: "作者" }, { key: "story_count", label: "剧本数" }, { key: "review_status", label: "审核", format: "status" }, { key: "status", label: "状态", format: "status" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
