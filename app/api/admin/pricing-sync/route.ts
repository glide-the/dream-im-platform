import { handlePricingSyncCreate } from "../../../lib/admin/pricing-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return await handlePricingSyncCreate(request);
}
