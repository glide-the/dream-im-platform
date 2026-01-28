import { NextResponse } from "next/server";
import { deleteCustomer, getCustomerById, updateCustomer } from "../../../lib/db";
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
  const customer = await getCustomerById(params.id);
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

  const current = await getCustomerById(params.id);
  if (!current) {
    return jsonError("客户不存在", 404);
  }
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
  const updated = await updateCustomer(next);

  if (!updated) {
    return jsonError("客户不存在", 404);
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const deleted = await deleteCustomer(params.id);

  if (!deleted) {
    return jsonError("客户不存在", 404);
  }

  return NextResponse.json({ success: true });
}
