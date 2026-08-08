import {
  handleAdminStorageList,
  handleAdminStorageUpload,
} from "@/lib/admin/storage-resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleAdminStorageList(request);
}

export async function POST(request: Request) {
  return await handleAdminStorageUpload(request);
}
