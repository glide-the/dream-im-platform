import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteFromWorkspace, resolveWorkspaceCwd } from "@/lib/claude-agent-kit/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  conversationId: z.string().min(1),
  path: z.array(z.string().min(1)).min(1),
});

export async function DELETE(
  _request: Request,
  context: { params: { conversationId?: string; path?: string[] } }
) {
  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid delete path." }, { status: 400 });
  }

  try {
    const { conversationId, path: pathSegments } = parsedParams.data;
    const cwd = await resolveWorkspaceCwd(conversationId);
    const filePath = pathSegments.join("/");
    await deleteFromWorkspace(cwd, filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete workspace file", error);
    return NextResponse.json({ error: "Failed to delete workspace file." }, { status: 500 });
  }
}
