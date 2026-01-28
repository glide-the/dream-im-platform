import { NextResponse } from "next/server";
import { buildCustomerCard, createAttachment } from "../../../lib/agent";
import { createConversation, findDuplicateCustomers } from "../../../lib/db";
import { createId } from "../../../lib/id";
import { CustomerCard } from "../../../lib/types";
import { researchCustomer, isAiResearchEnabled } from "../../../lib/ai-researcher";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: {
    query_text?: string;
    attachments?: { name: string; type: string; size: number }[];
    context_customer_ids?: string[];
  } | null = null;

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("请求体格式错误");
  }

  const queryText = body?.query_text?.trim();
  if (!queryText) {
    return badRequest("请输入客户单位或姓名");
  }

  let card: CustomerCard;
  let debug: { name?: string; company?: string };
  let usedAiResearch = false;

  if (isAiResearchEnabled()) {
    try {
      const result = await researchCustomer(queryText);
      card = result.card;
      debug = result.debug;
      usedAiResearch = true;
    } catch (error) {
      console.error("AI research failed, falling back to mock:", error);
      const result = buildCustomerCard(queryText);
      card = result.card;
      debug = result.debug;
    }
  } else {
    const result = buildCustomerCard(queryText);
    card = result.card;
    debug = result.debug;
  }

  const now = new Date().toISOString();

  const conversationId = createId("conv");
  const attachments = (body?.attachments ?? []).map((item) =>
    createAttachment(item)
  );

  const title = `【${debug.company || "未知公司"}】${
    debug.name || "客户"
  } 客户信息检索`;

  await createConversation({
    id: conversationId,
    title,
    status: "pending",
    created_at: now,
    updated_at: now,
    messages: [
      {
        id: createId("msg"),
        role: "user",
        content: queryText,
        created_at: now
      },
      {
        id: createId("msg"),
        role: "assistant",
        content: "已整理客户资料卡片，请确认后入库。",
        created_at: now
      }
    ],
    attachments,
    context_customer_ids: body?.context_customer_ids ?? [],
    ai_outputs: {
      customer_card: card
    }
  });

  const response: {
    conversation_id: string;
    customer_card: CustomerCard;
    action_suggestions: string[];
    research_method: "ai" | "mock";
  } = {
    conversation_id: conversationId,
    customer_card: card,
    action_suggestions: [
      "补充联系方式",
      "确认决策链",
      "创建跟进待办"
    ],
    research_method: usedAiResearch ? "ai" : "mock"
  };

  const duplicates = await findDuplicateCustomers(
    card.structured_fields.name,
    card.structured_fields.company
  );

  if (duplicates.length > 0) {
    response.action_suggestions.unshift("可能存在重复客户，请核对");
  }

  return NextResponse.json(response);
}
