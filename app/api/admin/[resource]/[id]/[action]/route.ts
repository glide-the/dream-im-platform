import { handleStorySourceAction } from "../../../../../lib/story-source/mutations";
import { handleProviderReachability } from "../../../../../lib/admin/provider-reachability";
import { handleModelValidation } from "../../../../../lib/admin/model-validation";
import {
  handleProviderDiscovery,
  handleProviderDiscoveryApply,
} from "../../../../../lib/admin/provider-discovery";
import {
  handleSubscriptionAction,
  isSubscriptionResource,
} from "../../../../../lib/subscriptions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ resource: string; id: string; action: string }>;
  },
) {
  const { resource, id, action } = await context.params;
  if (isSubscriptionResource(resource)) {
    return await handleSubscriptionAction(request, resource, id, action);
  }
  if (resource === "providers" && action === "reachability") {
    return await handleProviderReachability(request, id);
  }
  if (resource === "providers" && action === "discover") {
    return await handleProviderDiscovery(request, id);
  }
  if (resource === "providers" && action === "apply-discovery") {
    return await handleProviderDiscoveryApply(request, id);
  }
  if (resource === "models" && action === "validate") {
    return await handleModelValidation(request, id);
  }
  return await handleStorySourceAction(request, resource, id, action);
}
