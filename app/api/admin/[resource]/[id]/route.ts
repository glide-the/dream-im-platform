import { handleAdminResourceGetOne } from "../../../../lib/admin/resources";
import {
  handleAdminResourceDelete,
  handleAdminResourceUpdate,
} from "../../../../lib/admin/mutations";
import {
  handleSubscriptionDelete,
  handleSubscriptionGetOne,
  handleSubscriptionUpdate,
  isSubscriptionResource,
} from "../../../../lib/subscriptions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canonicalResource(resource: string) {
  return resource === "stories"
    ? "story-stories"
    : resource === "roles"
    ? "admin-roles"
    : resource === "permissions"
      ? "admin-permissions"
      : resource;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  if (isSubscriptionResource(resource)) {
    return await handleSubscriptionGetOne(request, resource, id);
  }
  return await handleAdminResourceGetOne(request, canonicalResource(resource), id);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  if (isSubscriptionResource(resource)) {
    return await handleSubscriptionUpdate(request, resource, id);
  }
  return await handleAdminResourceUpdate(request, canonicalResource(resource), id);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await context.params;
  if (isSubscriptionResource(resource)) {
    return await handleSubscriptionDelete(request, resource);
  }
  return await handleAdminResourceDelete(request, canonicalResource(resource), id);
}
