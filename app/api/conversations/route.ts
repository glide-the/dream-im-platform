import { NextResponse } from "next/server";
import { readDb } from "../../lib/db";
import { toNumber } from "../../lib/query";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = toNumber(searchParams.get("page"), 1);
  const pageSize = toNumber(searchParams.get("pageSize"), 6);
  const status = searchParams.get("status") ?? "";
  const search = (searchParams.get("search") ?? "").trim().toLowerCase();

  const db = await readDb();
  let conversations = [...db.conversations];

  if (status && status !== "all") {
    conversations = conversations.filter((item) => item.status === status);
  }

  if (search) {
    conversations = conversations.filter((item) =>
      item.title.toLowerCase().includes(search)
    );
  }

  conversations.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  const total = conversations.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const data = conversations.slice(start, start + pageSize);

  return NextResponse.json({
    data,
    meta: { page: safePage, pageSize, total, totalPages }
  });
}
