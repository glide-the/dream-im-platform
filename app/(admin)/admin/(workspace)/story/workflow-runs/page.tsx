import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function StoryWorkflowRunsPage() {
  return <AdminModulePage eyebrow="Story source / workflow runs" title="工作流运行" description="只读展示源 workflow_runs 的插件、预检、运行时锁、幂等与状态版本溯源。控制台不直接改写工作流状态；取消和重试必须进入源业务命令层。" status="不可直接改写" tabs={storyTabs}>
    <div className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary"><strong className="text-text-primary">安全边界：</strong>当前源项目没有 PostgreSQL 命令适配器，因此 Admin 仅提供查询与追踪，避免绕过 immutable provenance 和 status_version guard。</div>
    <AdminResourceTable resource="story-workflow-runs" title="真实工作流运行" description="保留 workflow_definition_ref、插件版本、重试链、幂等键与失败步骤。" defaultSort="created_at" filters={[{ field: "workspace_id", label: "Workspace ID", operator: "eq" }, { field: "status", label: "状态", operator: "eq" }, { field: "deck_plugin_id", label: "Deck Plugin", operator: "eq" }, { field: "error_code", label: "错误码", operator: "eq" }]} columns={[{ key: "id", label: "Run ID" }, { key: "workspace_name", label: "工作区" }, { key: "deck_plugin_id", label: "Plugin" }, { key: "deck_plugin_version", label: "Version" }, { key: "status", label: "状态", format: "status" }, { key: "failed_step", label: "失败步骤" }, { key: "error_code", label: "错误码" }, { key: "created_by", label: "创建者" }, { key: "created_at", label: "创建时间", format: "date" }]} />
  </AdminModulePage>;
}
