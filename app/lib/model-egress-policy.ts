// [Input] Dedicated PostgreSQL model-network policy values and optimistic mutations.
// [Output] Shared strict revisioned DTOs; proxy endpoints remain server configuration.
// [Pos] Server/client-neutral contract for the model-center Docker NAT switch.
import { z } from "zod";

export const modelEgressSetting = { category: "model_network", key: "docker_nat_proxy" } as const;
export const modelEgressStoredSchema = z.object({ revision: z.number().int().positive().safe(), enabled: z.boolean() }).strict();
export const modelEgressMutationSchema = z.object({ expectedRevision: z.number().int().positive().safe().nullable(), enabled: z.boolean() }).strict();
export type ModelEgressPolicy = {
  defaultEnabled: false;
  desiredEnabled: boolean;
  effectiveEnabled: boolean;
  configured: boolean;
  revision: number | null;
  status: "enabled" | "disabled" | "unavailable";
};
