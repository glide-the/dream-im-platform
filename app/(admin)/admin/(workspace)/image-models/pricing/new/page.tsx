// [Input] Model route identity, query defaults, and shared Admin fields.
// [Output] Context-aware Image/text model form using existing audited writes.
// [Pos] Shared presentation; model validation and persistence remain server-owned.
// [Sync] 2026-10-10: retain independent center navigation without duplicating model management.

import PricingVersionFormPage from "@/components/admin/PricingVersionFormPage";
export default async function NewImagePricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <PricingVersionFormPage modelId={typeof query.modelId === "string" ? query.modelId : ""}
    replaces={typeof query.replaces === "string" ? query.replaces : undefined}
    initialEffectiveFrom={new Date().toISOString()} imageMode />;
}
