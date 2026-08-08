import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import StorySourceEditor from "@/components/admin/StorySourceEditor";

export default function StoryStoriesPage() {
  return <AdminModulePage eyebrow="Story source / stories" title="剧本项目" description="直接运营 story_workspace_stories。确认剧本会按源业务语义同步确认其待审场景与关联角色；归档替代硬删除。" status="审核可追溯" tabs={storyTabs}>
    <StorySourceEditor resource="story-stories" title="剧本编辑与审核" description="标题、简介、正文和类型遵循源项目 Patch 契约；审核操作仅适用于 Agent 生成内容。" reviewActions fields={[{ key: "title", label: "标题" }, { key: "description", label: "简介", type: "textarea" }, { key: "content", label: "正文", type: "textarea" }, { key: "type", label: "类型", type: "select", options: [{ label: "短篇", value: "short" }, { label: "长篇", value: "long" }, { label: "剧本", value: "script" }, { label: "大纲", value: "outline" }] }]} />
    <AdminResourceTable resource="story-stories" title="真实剧本" description="按工作区、作者、内容状态与审核状态查询。" defaultSort="updated_at" filters={[{ field: "title", label: "标题" }, { field: "workspace_id", label: "Workspace ID", operator: "eq" }, { field: "review_status", label: "审核状态", operator: "eq", options: [{ label: "待审核", value: "pending" }, { label: "已确认", value: "confirmed" }, { label: "已拒绝", value: "rejected" }] }, { field: "status", label: "内容状态", operator: "eq", options: [{ label: "草稿", value: "draft" }, { label: "已发布", value: "published" }, { label: "已归档", value: "archived" }] }]} columns={[{ key: "id", label: "Story ID" }, { key: "title", label: "标题" }, { key: "workspace_name", label: "工作区" }, { key: "author_email", label: "作者" }, { key: "type", label: "类型", format: "status" }, { key: "status", label: "状态", format: "status" }, { key: "review_status", label: "审核", format: "status" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
