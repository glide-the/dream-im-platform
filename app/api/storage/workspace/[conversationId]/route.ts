import { NextResponse } from "next/server";
import { z } from "zod";
import { listWorkspaceFiles, resolveWorkspaceCwd } from "@/lib/claude-agent-kit/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  conversationId: z.string().min(1),
});

export async function GET(
  _request: Request,
  context: { params: { conversationId?: string } }
) {
  const parsed = paramsSchema.safeParse(context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
  }

  try {
    const cwd = await resolveWorkspaceCwd(parsed.data.conversationId);
    const files = await listWorkspaceFiles(cwd);
    return NextResponse.json({ data: files });
  } catch (error) {
    console.error("Failed to list workspace files", error);
    return NextResponse.json({ error: "Failed to list workspace files." }, { status: 500 });
  }
}
