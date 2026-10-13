// [Input] Immutable Image model price versions.
// [Output] Independent Image Pricing workspace.
// [Pos] Shared lifecycle; no separate ledger or price store.
// [Sync] 2026-10-10: establish the independent Image model center.

import ImageModelCenterPage from "@/components/admin/ImageModelCenterPage";
import AIPricingTimeline from "@/components/admin/AIPricingTimeline";
export default function ImagePricingPage() {
  return <ImageModelCenterPage><AIPricingTimeline imageOnly /></ImageModelCenterPage>;
}
