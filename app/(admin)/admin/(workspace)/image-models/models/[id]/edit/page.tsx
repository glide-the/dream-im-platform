// [Input] Model route identity, query defaults, and shared Admin fields.
// [Output] Context-aware Image/text model form using existing audited writes.
// [Pos] Shared presentation; model validation and persistence remain server-owned.
// [Sync] 2026-10-10: retain independent center navigation without duplicating model management.

import ModelFormPage from "@/components/admin/ModelFormPage";
export default async function EditModelPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  
  return <ModelFormPage mode="edit" recordId={id} imageMode={true} />;
}
