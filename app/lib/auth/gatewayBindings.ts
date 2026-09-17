// [Input] Explicit service-to-Gateway/OAuth client binding configuration.
// [Output] Strict client associations used by Admin-issued grants and Gateway authorization.
// [Pos] Server policy reference; no business IDs, secret sharing or caller overrides.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "./config";
export function gatewayClientBindings() {
  let input: unknown; try { input = JSON.parse(requiredAuthValue("DREAM_GATEWAY_CLIENT_BINDINGS")); } catch { throw new AuthBoundaryError("RUNTIME_GATEWAY_NOT_CONFIGURED"); }
  const result = z.array(z.strictObject({ service_client_id: z.string().min(1), gateway_client_id: z.string().min(1), oauth_client_ids: z.array(z.string().min(1)).min(1) })).min(1).safeParse(input);
  if (!result.success || new Set(result.data.map(entry => entry.service_client_id)).size !== result.data.length) throw new AuthBoundaryError("RUNTIME_GATEWAY_NOT_CONFIGURED");
  return result.data;
}
export function gatewayClientForService(serviceId: string) {
  const binding = gatewayClientBindings().find(entry => entry.service_client_id === serviceId);
  if (!binding) throw new AuthBoundaryError("RUNTIME_GATEWAY_NOT_CONFIGURED");
  return binding;
}
