// [Input] Protected model-network configuration GET/PATCH requests.
// [Output] Provider-authorized projection and audited optimistic mutation.
// [Pos] Thin route; validation, SQL and network policy remain in app/lib.
import { handleModelEgressGet, handleModelEgressPatch } from "@/lib/admin/model-egress";
export const dynamic = "force-dynamic";
export const GET = handleModelEgressGet;
export const PATCH = handleModelEgressPatch;
