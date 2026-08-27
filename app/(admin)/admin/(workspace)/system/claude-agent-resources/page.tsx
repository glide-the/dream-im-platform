// [Input] Authenticated Admin system-governance route.
// [Output] Claude Agent resource policy and live diagnostics console.
// [Pos] Read-only monitoring plus desired-policy editing; no runtime process controls.

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
