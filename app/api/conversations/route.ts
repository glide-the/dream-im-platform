import { NextResponse } from "next/server";
import { listConversations } from "../../lib/db";
import { toNumber } from "../../lib/query";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = toNumber(searchParams.get("page"), 1);
  const pageSize = toNumber(searchParams.get("pageSize"), 6);
  const status = searchParams.get("status") ?? "";
  const search = (searchParams.get("search") ?? "").trim().toLowerCase();

  const result = await listConversations({
    page,
    pageSize,
    status,
    search
  });

  return NextResponse.json({
    data: result.data,
    meta: result.meta
  });
}
