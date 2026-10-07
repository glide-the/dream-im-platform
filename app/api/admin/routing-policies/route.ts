// [Input] Protected routing policy list or strict save request.
// [Output] Safe list or audited CAS save response.
// [Pos] Thin routing policy ingress; business validation stays in app/lib/admin.
import { handleRoutingPolicySave } from "../../../lib/admin/routing-policies";
import { handleAdminResourceList } from "../../../lib/admin/resources";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleAdminResourceList(request, "routing-policies"); }
export async function POST(request: Request) { return handleRoutingPolicySave(request); }
