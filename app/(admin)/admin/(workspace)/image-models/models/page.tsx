// [Input] Existing Image-capable model rows.
// [Output] Independent Image Models workspace.
// [Pos] Model validation and persistence stay in Admin APIs.
// [Sync] 2026-10-10: establish the independent Image model center.

import ImageModelCenterPage from "@/components/admin/ImageModelCenterPage";
import AIModelRegistry from "@/components/admin/AIModelRegistry";
export default function ImageModelsPage() {
  return <ImageModelCenterPage><AIModelRegistry imageOnly /></ImageModelCenterPage>;
}
