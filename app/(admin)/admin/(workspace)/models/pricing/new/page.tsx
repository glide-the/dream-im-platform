import PricingVersionFormPage from "@/components/admin/PricingVersionFormPage";

export default async function NewPricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const modelId = typeof query.modelId === "string" ? query.modelId : "";
  const replaces = typeof query.replaces === "string" ? query.replaces : undefined;
  return <PricingVersionFormPage modelId={modelId} replaces={replaces} initialEffectiveFrom={new Date().toISOString()} />;
}
