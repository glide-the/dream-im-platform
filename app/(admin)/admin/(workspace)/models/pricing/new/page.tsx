// [Input] Optional model/replacement identity and explicit Image-center mode from the Admin URL.
// [Output] Shared revisioned pricing form with text or Image Token price fields.
// [Pos] AI model-center pricing creation route; validation, transaction, and audit remain server-side.
// [Sync] 2026-10-09: preserve Image mode when opening a new pricing version.

import PricingVersionFormPage from "@/components/admin/PricingVersionFormPage";

export default async function NewPricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const modelId = typeof query.modelId === "string" ? query.modelId : "";
  const replaces = typeof query.replaces === "string" ? query.replaces : undefined;
  return <PricingVersionFormPage modelId={modelId} replaces={replaces} initialEffectiveFrom={new Date().toISOString()} imageMode={query.kind === "image"} />;
}
