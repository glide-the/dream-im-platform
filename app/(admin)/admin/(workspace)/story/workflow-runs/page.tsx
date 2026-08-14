// [Input] Admin Story navigation and the read-only Workflow Run resource.
// [Output] Dream Run list using the same canonical-first display-title policy.
// [Pos] Admin Story operations route; no workflow control or Artifact writes.

import AdminModulePage, { storyTabs } from "@/components/admin/AdminModulePage";
import { StoryWorkflowRunsResourceView } from "@/components/admin/AdminResourceViews";

export default function StoryWorkflowRunsPage() {
  return (
    <AdminModulePage
      eyebrow="Story operations / Dream runs"
      title="Dream 运行"
      description="使用 canonical Project 标题识别运行；Project 尚未建立时才回退到创作目标前缀。"
      status="只读运行索引"
      tabs={storyTabs}
    >
      <StoryWorkflowRunsResourceView />
    </AdminModulePage>
  );
}
