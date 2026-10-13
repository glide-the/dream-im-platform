// [Input] Model route identity, query defaults, and shared Admin fields.
// [Output] Context-aware Image/text model form using existing audited writes.
// [Pos] Shared presentation; model validation and persistence remain server-owned.
// [Sync] 2026-10-10: retain independent center navigation without duplicating model management.

import ModelFormPage from "@/components/admin/ModelFormPage";
export default async function NewModelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <ModelFormPage mode="create" imageMode={true}
    providerId={typeof query.providerId === "string" ? query.providerId : ""}
    upstreamModel={typeof query.upstreamModel === "string" ? query.upstreamModel : ""} />;
}
