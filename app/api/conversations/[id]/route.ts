import { NextResponse } from "next/server";
import { withDb } from "../../../lib/db";
import { Conversation } from "../../../lib/types";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  let body: Partial<Conversation> | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("请求体格式错误");
  }

  const now = new Date().toISOString();

  const updated = await withDb((db) => {
    const index = db.conversations.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return { db, result: null };
    }
    const current = db.conversations[index];
    const next: Conversation = {
      ...current,
      status: (body?.status as Conversation["status"]) ?? current.status,
      linked_customer_id:
        body?.linked_customer_id ?? current.linked_customer_id,
      ai_outputs: body?.ai_outputs ?? current.ai_outputs,
      updated_at: now
    };
    const conversations = [...db.conversations];
    conversations[index] = next;
    return { db: { ...db, conversations }, result: next };
  });

  if (!updated) {
    return jsonError("会话不存在", 404);
  }

  return NextResponse.json({ data: updated });
}
