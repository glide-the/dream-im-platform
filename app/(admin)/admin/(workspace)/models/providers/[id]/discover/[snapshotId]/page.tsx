import ProviderDiscoveryReview from "@/components/admin/ProviderDiscoveryReview";

export default async function ProviderDiscoveryPage({
  params,
}: {
  params: Promise<{ id: string; snapshotId: string }>;
}) {
  const { id, snapshotId } = await params;
  return <ProviderDiscoveryReview providerId={id} snapshotId={snapshotId} />;
}
