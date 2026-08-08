import {
  handleAdminStorageDelete,
  handleAdminStorageGet,
} from "@/lib/admin/storage-resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleAdminStorageGet(request, id);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleAdminStorageDelete(request, id);
}
