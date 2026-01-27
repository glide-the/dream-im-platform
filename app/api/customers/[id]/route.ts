import { NextResponse } from "next/server";
import { readDb, withDb } from "../../../lib/db";
import { Customer } from "../../../lib/types";

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

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const db = await readDb();
  const customer = db.customers.find((item) => item.id === params.id);
  if (!customer) {
    return jsonError("客户不存在", 404);
  }
  return NextResponse.json({ data: customer });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  let body: Partial<Customer> | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("请求体格式错误");
  }

  const now = new Date().toISOString();

  const updated = await withDb((db) => {
    const index = db.customers.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return { db, result: null };
    }
    const current = db.customers[index];
    const next: Customer = {
      ...current,
      name: body?.name?.trim() ?? current.name,
      company: body?.company?.trim() ?? current.company,
      title: body?.title?.trim() ?? current.title,
      phones: body?.phones ? normalizeList(body.phones) : current.phones,
      emails: body?.emails ? normalizeList(body.emails) : current.emails,
      wechat: body?.wechat?.trim() ?? current.wechat,
      address: body?.address?.trim() ?? current.address,
      tags: body?.tags ? normalizeList(body.tags) : current.tags,
      profile_markdown:
        body?.profile_markdown ?? current.profile_markdown,
      last_verified_at: body?.last_verified_at ?? current.last_verified_at,
      updated_at: now
    };
    const customers = [...db.customers];
    customers[index] = next;
    return { db: { ...db, customers }, result: next };
  });

  if (!updated) {
    return jsonError("客户不存在", 404);
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const deleted = await withDb((db) => {
    const exists = db.customers.some((item) => item.id === params.id);
    if (!exists) {
      return { db, result: null };
    }
    return {
      db: {
        ...db,
        customers: db.customers.filter((item) => item.id !== params.id)
      },
      result: true
    };
  });

  if (!deleted) {
    return jsonError("客户不存在", 404);
  }

  return NextResponse.json({ success: true });
}
