import { handleAdminResourceList } from "../../../lib/admin/resources";
import { handleAdminResourceCreate } from "../../../lib/admin/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canonicalResource(resource: string) {
  return resource === "roles"
    ? "admin-roles"
    : resource === "permissions"
      ? "admin-permissions"
      : resource;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  return await handleAdminResourceList(request, canonicalResource(resource));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  return await handleAdminResourceCreate(request, canonicalResource(resource));
}
