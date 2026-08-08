import { handleStorySourceAction } from "../../../../../lib/story-source/mutations";
import { handleProviderReachability } from "../../../../../lib/admin/provider-reachability";
import { handleModelValidation } from "../../../../../lib/admin/model-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ resource: string; id: string; action: string }>;
  },
) {
  const { resource, id, action } = await context.params;
  if (resource === "providers" && action === "reachability") {
    return await handleProviderReachability(request, id);
  }
  if (resource === "models" && action === "validate") {
    return await handleModelValidation(request, id);
  }
  return await handleStorySourceAction(request, resource, id, action);
}
