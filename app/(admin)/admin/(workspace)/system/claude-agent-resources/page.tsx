// [Input] Authenticated Admin system-governance route.
// [Output] Claude Agent resource policy and PostgreSQL observer console.
// [Pos] Snapshot monitoring plus desired-policy editing; no Dream HTTP, deployment, or process controls.
// [Sync] 2026-08-27: describe the PostgreSQL latest-instance observer contract.

import AdminModulePage from "@/components/admin/AdminModulePage";
import ClaudeAgentResourceConsole from "@/components/admin/ClaudeAgentResourceConsole";

export default function ClaudeAgentResourcesPage() {
  return (
    <AdminModulePage
      eyebrow="System governance / Claude Agent admission"
      title="Claude Agent 资源"
      description="查看单实例准入、Linux/cgroup 内存和生命周期计数，并维护受约束的期望阈值。"
      status="10 秒刷新"
    >
      <ClaudeAgentResourceConsole />
    </AdminModulePage>
  );
}
