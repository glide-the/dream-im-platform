import { NextResponse, NextRequest } from "next/server";
import { getConversationByCustomerId } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ customerId: string }> }
) {
  const { customerId } = await context.params;
  
  if (!customerId) {
    return NextResponse.json(
      { error: "Customer ID is required" },
      { status: 400 }
    );
  }

  const conversation = await getConversationByCustomerId(customerId);

  return NextResponse.json({
    data: conversation,
  });
}
