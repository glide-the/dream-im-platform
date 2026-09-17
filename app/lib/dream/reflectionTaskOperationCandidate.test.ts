// [Input] Reviewed registration-source artifact and current sixteen Reflections DTO contracts.
// [Output] Exact per-operation schema hashes, scopes, requirements and aggregate artifact digest evidence.
// [Pos] Registration-source drift gate; Registry99 must carry the same schemas and hashes.
// [Sync] 2026-09-15: bind the reviewed source snapshot to the registered event high-water contract.
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import artifact from "../../../docs/architecture/admin-dream-reflection-task-operation-candidate.json";
import { identitySchemaRequirement } from "./schemaRequirements";
import { canonicalContractJson } from "./operationRegistry";
import { reflectionTaskOperationContracts } from "./reflectionTaskDto";
import { reflectionTaskSchemaRequirements } from "./reflectionTaskService";

it("matches every current DTO and requirement used by Registry99", () => {
  const operations = Object.entries(reflectionTaskOperationContracts).map(([name, operation]) => {
    const contract = { name, input_schema_version: 1, output_schema_version: 1, input: z.toJSONSchema(operation.input, { io: "input" }), output: z.toJSONSchema(operation.output, { io: "output" }) };
    return { name, audience: operation.audience, kind: operation.kind, user_scope: operation.audience === "oauth" ? operation.userScope : null,
      background_scope: operation.audience === "background" ? operation.backgroundScope : null, contract,
      contract_sha256: createHash("sha256").update(canonicalContractJson(contract)).digest("hex") };
  });
  const body = { version: 1, status: "registered_registry99_source", requirements: [identitySchemaRequirement, ...reflectionTaskSchemaRequirements], operations };
  expect(artifact).toEqual({ artifact_sha256: createHash("sha256").update(canonicalContractJson(body)).digest("hex"), ...body });
  expect(operations).toHaveLength(16);
});
