// [Input] Protected Admin workspace layout and ClaudePlugin Marketplace manager.
// [Output] Operator page for the platform-global remote Marketplace catalog.
// [Pos] Admin /resources/claude-plugin-marketplaces route.
// [Sync] 2026-08-19: add Remote Marketplace operations page without bucket semantics.

import AdminModulePage from "@/components/admin/AdminModulePage";
import ClaudePluginMarketplaceManager from "@/components/admin/ClaudePluginMarketplaceManager";

export default function ClaudePluginMarketplacesPage() {
  return <AdminModulePage
    eyebrow="Resource management / ClaudePlugin"
    title="ClaudePlugin Marketplace"
    description="维护所有 Dream 用户共享的远程插件目录：登记 Git 来源、同步不可变 revision，并逐项批准可安装版本。"
    status="全局目录 · 无 Marketplace 桶"
  >
    <ClaudePluginMarketplaceManager />
  </AdminModulePage>;
}
