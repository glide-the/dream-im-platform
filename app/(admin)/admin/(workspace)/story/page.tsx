import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";
import AdminResourceTable from "@/components/admin/AdminResourceTable";

export default function AdminStoryPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          PostgreSQL story operations
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">剧本数据运营中心</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
          工作区、项目、角色、场景和工作流运行均由 Ink Memory PostgreSQL 管理。所有写操作经过 RBAC、严格校验与审计。
        </p>
      </header>

      <AdminCrudWorkbench
        resource="story-workspaces"
        title="工作区维护"
        description="创建创作空间，或按 ID 修改名称、描述、状态和元数据。"
        createTemplate={{ ownerUserId: "user_...", name: "新创作空间", slug: "new-workspace", description: "", status: "active", metadata: {} }}
        updateTemplate={{ name: "更新后的空间名称", status: "active", metadata: {} }}
      />
      <AdminResourceTable
        resource="story-workspaces"
        title="Story Workspaces"
        description="创作空间所有权和运营状态。"
        defaultSort="updated_at"
        columns={[
          { key: "id", label: "Workspace ID" },
          { key: "name", label: "名称" },
          { key: "slug", label: "Slug" },
          { key: "owner_email", label: "所有者" },
          { key: "status", label: "状态", format: "status" },
          { key: "updated_at", label: "更新时间", format: "date" },
        ]}
      />

      <AdminCrudWorkbench
        resource="story-projects"
        title="剧本项目维护"
        description="维护项目归属、审核状态、内容统计和发布时间。"
        createTemplate={{ workspaceId: "workspace_...", ownerUserId: "user_...", identifier: "story-demo", title: "未命名剧本", synopsis: "", storyType: "screenplay", status: "draft", reviewStatus: "pending", characterCount: 0, sceneCount: 0, wordCount: 0, settings: {}, agentGenerated: false }}
        updateTemplate={{ title: "更新后的剧本标题", status: "draft", reviewStatus: "pending", wordCount: 0 }}
      />
      <AdminResourceTable
        resource="story-projects"
        title="Story Projects"
        description="剧本状态、作者、工作区与内容规模。"
        defaultSort="updated_at"
        columns={[
          { key: "id", label: "Story ID" },
          { key: "title", label: "标题" },
          { key: "owner_email", label: "作者" },
          { key: "workspace_name", label: "Workspace" },
          { key: "status", label: "状态", format: "status" },
          { key: "review_status", label: "审核", format: "status" },
          { key: "word_count", label: "字数" },
          { key: "updated_at", label: "更新时间", format: "date" },
        ]}
      />

      <AdminCrudWorkbench
        resource="story-characters"
        title="角色维护"
        description="维护角色定位、人物说明、结构化档案与排序。"
        createTemplate={{ projectId: "story_...", name: "角色姓名", roleType: "protagonist", description: "", profile: {}, sortOrder: 0, status: "active" }}
        updateTemplate={{ name: "角色姓名", roleType: "protagonist", description: "", profile: {}, sortOrder: 0, status: "active" }}
      />
      <AdminResourceTable
        resource="story-characters"
        title="Story Characters"
        description="剧本角色及其运营状态。"
        defaultSort="sort_order"
        columns={[
          { key: "id", label: "Character ID" },
          { key: "project_title", label: "剧本" },
          { key: "name", label: "角色" },
          { key: "role_type", label: "定位" },
          { key: "sort_order", label: "排序" },
          { key: "status", label: "状态", format: "status" },
        ]}
      />

      <AdminCrudWorkbench
        resource="story-scenes"
        title="场景维护"
        description="维护场景概要、正文、状态、排序与字数。"
        createTemplate={{ projectId: "story_...", title: "第一场", summary: "", content: "", status: "draft", sortOrder: 0, wordCount: 0, metadata: {} }}
        updateTemplate={{ title: "更新后的场景标题", status: "draft", sortOrder: 0, wordCount: 0 }}
      />
      <AdminResourceTable
        resource="story-scenes"
        title="Story Scenes"
        description="分场内容及生产进度。"
        defaultSort="sort_order"
        columns={[
          { key: "id", label: "Scene ID" },
          { key: "project_title", label: "剧本" },
          { key: "title", label: "场景" },
          { key: "sort_order", label: "排序" },
          { key: "word_count", label: "字数" },
          { key: "status", label: "状态", format: "status" },
        ]}
      />

      <AdminCrudWorkbench
        resource="story-workflow-runs"
        title="工作流运行维护"
        description="登记或修正剧本工作流的版本、执行状态、输入输出及错误信息。"
        createTemplate={{ workspaceId: "workspace_...", projectId: null, createdByUserId: "user_...", workflowCode: "story-generation", workflowVersion: "1", status: "queued", input: {}, output: {} }}
        updateTemplate={{ status: "running", failedStep: null, errorCode: null, errorMessage: null, output: {} }}
      />
      <AdminResourceTable
        resource="story-workflow-runs"
        title="Workflow Runs"
        description="运行状态、工作流版本、错误分类与时间边界。"
        columns={[
          { key: "id", label: "Run ID" },
          { key: "workspace_name", label: "Workspace" },
          { key: "project_title", label: "剧本" },
          { key: "created_by_email", label: "创建者" },
          { key: "workflow_code", label: "Workflow" },
          { key: "workflow_version", label: "Version" },
          { key: "status", label: "状态", format: "status" },
          { key: "error_code", label: "Error" },
          { key: "created_at", label: "时间", format: "date" },
        ]}
      />
    </div>
  );
}
