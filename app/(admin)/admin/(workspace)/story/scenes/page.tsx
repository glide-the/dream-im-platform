import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import StorySourceEditor from "@/components/admin/StorySourceEditor";

export default function StoryScenesPage() {
  return <AdminModulePage eyebrow="Story source / scenes" title="场景" description="场景归属于工作区，story_id 可为空；变更父剧本时服务端强制校验同一作者与工作区，避免跨租户外键串联。" status="外键保护" tabs={storyTabs}>
    <StorySourceEditor resource="story-scenes" title="场景编辑与审核" description="场景顺序、名称、简介和父剧本遵循源 Patch 契约；归档替代硬删除。" reviewActions fields={[{ key: "name", label: "场景名" }, { key: "description", label: "场景描述", type: "textarea" }, { key: "storyId", label: "父剧本 ID" }, { key: "orderIndex", label: "顺序", type: "number" }]} />
    <AdminResourceTable resource="story-scenes" title="真实场景" description="按父剧本、工作区与审核状态查询场景。" defaultSort="updated_at" filters={[{ field: "name", label: "场景名" }, { field: "story_id", label: "Story ID", operator: "eq" }, { field: "workspace_id", label: "Workspace ID", operator: "eq" }, { field: "review_status", label: "审核状态", operator: "eq", options: [{ label: "待审核", value: "pending" }, { label: "已确认", value: "confirmed" }, { label: "已拒绝", value: "rejected" }] }]} columns={[{ key: "id", label: "Scene ID" }, { key: "name", label: "场景" }, { key: "story_title", label: "剧本" }, { key: "workspace_name", label: "工作区" }, { key: "order_index", label: "顺序" }, { key: "review_status", label: "审核", format: "status" }, { key: "status", label: "状态", format: "status" }, { key: "updated_at", label: "更新时间", format: "date" }]} />
  </AdminModulePage>;
}
