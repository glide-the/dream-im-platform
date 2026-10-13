// [Input] Server-authorized Image Provider projections.
// [Output] Codex/OpenAI workspace with shared registry interaction.
// [Pos] Independent Image center; credentials are not duplicated.
// [Sync] 2026-10-10: establish the independent Image model center.
// [Sync] 2026-10-10: render the shared Provider registry without a duplicate readiness summary.

import ImageModelCenterPage from "@/components/admin/ImageModelCenterPage";
import AIProviderRegistry from "@/components/admin/AIProviderRegistry";
export default function ImageProvidersPage() {
  return <ImageModelCenterPage><AIProviderRegistry imageOnly /></ImageModelCenterPage>;
}
