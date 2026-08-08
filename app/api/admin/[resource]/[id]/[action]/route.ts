import { handleStorySourceAction } from "../../../../../lib/story-source/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ resource: string; id: string; action: string }>;
  },
) {
  const { resource, id, action } = await context.params;
  return await handleStorySourceAction(request, resource, id, action);
}
