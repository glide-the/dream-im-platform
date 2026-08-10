import { handleStoryArtifactPreview } from "../../../../../lib/story-artifacts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleStoryArtifactPreview(request, id);
}
