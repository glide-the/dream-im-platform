import { handleAdminResourceGetOne } from "../../../../lib/admin/resources";
import {
  handleAdminResourceDelete,
  handleAdminResourceUpdate,
} from "../../../../lib/admin/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  return await handleAdminResourceGetOne(request, resource, id);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  return await handleAdminResourceUpdate(request, resource, id);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  return await handleAdminResourceDelete(request, resource, id);
}
