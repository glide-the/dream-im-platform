import { handleAdminResourceGetOne } from "../../../../lib/admin/resources";
import {
  handleAdminResourceDelete,
  handleAdminResourceUpdate,
} from "../../../../lib/admin/mutations";

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
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  return await handleAdminResourceGetOne(request, canonicalResource(resource), id);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  return await handleAdminResourceUpdate(request, canonicalResource(resource), id);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  return await handleAdminResourceDelete(request, canonicalResource(resource), id);
}
