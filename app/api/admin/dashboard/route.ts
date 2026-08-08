import { handleAdminDashboard } from "../../../lib/admin/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleAdminDashboard(request);
}
