import { handleAdminUsageDashboard } from "../../../lib/admin/usage-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleAdminUsageDashboard(request);
}
