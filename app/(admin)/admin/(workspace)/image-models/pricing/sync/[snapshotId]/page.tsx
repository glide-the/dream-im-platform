// [Input] Existing immutable models.dev snapshot ID.
// [Output] Shared pricing review in the independent Image center.
// [Pos] Route only; catalog matching, authorization and price application remain server-owned.
// [Sync] 2026-10-10: reuse the pricing discovery/apply flow for Image reference prices.

import PricingSyncReview from "@/components/admin/PricingSyncReview";

export default async function ImagePricingSyncPage({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  return <PricingSyncReview snapshotId={snapshotId} imageOnly />;
}
