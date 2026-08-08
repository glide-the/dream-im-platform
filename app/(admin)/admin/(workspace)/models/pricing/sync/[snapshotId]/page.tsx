import PricingSyncReview from "@/components/admin/PricingSyncReview";

export default async function PricingSyncPage({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = await params;
  return <PricingSyncReview snapshotId={snapshotId} />;
}
