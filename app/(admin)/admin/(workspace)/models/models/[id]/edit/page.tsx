// [Input] Model route identity, query defaults, and shared Admin fields.
// [Output] Context-aware Image/text model form using existing audited writes.
// [Pos] Shared presentation; model validation and persistence remain server-owned.
// [Sync] 2026-10-10: retain independent center navigation without duplicating model management.

import ModelFormPage from "@/components/admin/ModelFormPage";
export default async function EditModelPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <ModelFormPage mode="edit" recordId={id} imageMode={query.kind === "image"} />;
}
