// [Input] Same-model path and strict health range query behind Admin Session/RBAC.
// [Output] Safe aggregate health response without upstream or business writes.
// [Pos] Thin routing observation ingress; DTO and SQL remain in app/lib/admin.
import { handleRoutingHealth } from "../../../../../lib/admin/routing-health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoutingHealth(request, (await context.params).id);
}
