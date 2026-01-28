import { NextResponse } from "next/server";
import { updateConversationLink } from "../../../lib/db";
import { Conversation } from "../../../lib/types";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: Partial<Conversation> | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("请求体格式错误");
  }

  const now = new Date().toISOString();

  const updated = await updateConversationLink(id, {
    status: (body?.status as Conversation["status"]) ?? undefined,
    linked_customer_id: body?.linked_customer_id ?? undefined,
    ai_outputs: body?.ai_outputs ?? undefined,
    updated_at: now
  });

  if (!updated) {
    return jsonError("会话不存在", 404);
  }

  return NextResponse.json({ data: updated });
}
