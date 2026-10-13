// [Input] Protected Image model-center entry.
// [Output] Default Models workspace.
// [Pos] Navigation only; resource APIs remain unchanged.
// [Sync] 2026-10-10: establish the independent Image model center.

import { redirect } from "next/navigation";
export default function ImageModelCenterIndex() { redirect("/admin/image-models/models"); }
