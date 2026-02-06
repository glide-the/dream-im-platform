import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceCwd, uploadToWorkspace } from "@/lib/claude-agent-kit/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  conversationId: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: { conversationId?: string } }
) {
  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const cwd = await resolveWorkspaceCwd(parsedParams.data.conversationId);
    const uploaded = await uploadToWorkspace(cwd, file);

    return NextResponse.json({ data: uploaded });
  } catch (error) {
    console.error("Failed to upload workspace file", error);
    return NextResponse.json({ error: "Failed to upload workspace file." }, { status: 500 });
  }
}
