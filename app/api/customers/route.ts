import { NextResponse } from "next/server";
import { readDb, withDb } from "../../lib/db";
import { createId } from "../../lib/id";
import {
  filterCustomers,
  paginate,
  searchCustomers,
  sortCustomers,
  toNumber
} from "../../lib/query";
import { Customer } from "../../lib/types";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeList(input?: string | string[]) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  return input
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = toNumber(searchParams.get("page"), 1);
  const pageSize = toNumber(searchParams.get("pageSize"), 6);
  const search = searchParams.get("search") ?? "";
  const sort = searchParams.get("sort") ?? "updated_at";
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";
  const tag = searchParams.get("tag") ?? "";
  const hasContact = searchParams.get("hasContact") === "1";

  const db = await readDb();
  let result = searchCustomers(db.customers, search);
  result = filterCustomers(result, { tag, hasContact });
  result = sortCustomers(result, sort, order);

  const { data, meta } = paginate(result, page, pageSize);
  const tagOptions = Array.from(
    new Set(db.customers.flatMap((customer) => customer.tags ?? []))
  );

  return NextResponse.json({
    data,
    meta: {
      ...meta,
      tagOptions,
      totalCustomers: db.customers.length
    }
  });
}

export async function POST(request: Request) {
  let body: Partial<Customer> & { conversation_id?: string } | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("请求体格式错误");
  }

  const name = body?.name?.trim();
  const company = body?.company?.trim();
  if (!name && !company) {
    return jsonError("至少填写姓名或公司");
  }

  const now = new Date().toISOString();
  const customer: Customer = {
    id: createId("cus"),
    name,
    company,
    title: body?.title?.trim() || "",
    phones: normalizeList(body?.phones ?? []),
    emails: normalizeList(body?.emails ?? []),
    wechat: body?.wechat?.trim() || "",
    address: body?.address?.trim() || "",
    tags: normalizeList(body?.tags ?? []),
    profile_markdown: body?.profile_markdown || "",
    created_at: now,
    updated_at: now,
    source: body?.source ?? "manual",
    last_verified_at: body?.last_verified_at ?? now
  };

  const result = await withDb((db) => {
    const conversations = db.conversations.map((conv) => {
      if (body?.conversation_id && conv.id === body.conversation_id) {
        return {
          ...conv,
          status: "confirmed" as const,
          linked_customer_id: customer.id,
          updated_at: now
        };
      }
      return conv;
    });
    return {
      db: {
        ...db,
        customers: [customer, ...db.customers],
        conversations
      },
      result: customer
    };
  });

  return NextResponse.json({ data: result }, { status: 201 });
}
