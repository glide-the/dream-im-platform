import { NextResponse } from "next/server";
import { z } from "zod";
import { moveInWorkspace, resolveWorkspaceCwd } from "@/lib/claude-agent-kit/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  conversationId: z.string().min(1),
});

const bodySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export async function PATCH(
  request: Request,
  context: { params: { conversationId?: string } }
) {
  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid move payload." }, { status: 400 });
  }

  try {
    const cwd = await resolveWorkspaceCwd(parsedParams.data.conversationId);
    await moveInWorkspace(cwd, parsedBody.data.from, parsedBody.data.to);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to move workspace file", error);
    return NextResponse.json({ error: "Failed to move workspace file." }, { status: 500 });
  }
}
