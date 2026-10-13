// [Input] Legacy Image URLs nested under AI model management.
// [Output] Compatibility redirect into the independent Image center.
// [Pos] No resource UI or business behavior; bookmarks remain usable.
// [Sync] 2026-10-10: establish the independent Image model center.
// [Sync] 2026-10-10: route legacy request bookmarks directly to the existing Gateway log.

import { redirect } from "next/navigation";
export default async function LegacyImageModelsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  if (query.view === "requests") redirect("/admin/gateway/requests");
  const section = query.view === "pricing" ? "pricing" : "models";
  redirect(`/admin/image-models/${section}`);
}
