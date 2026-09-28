// [Input] Append-only Admin operation registry and published queue/task-session schema capabilities.
// [Output] Exact Registry192-198 names, hashes, scopes and schema requirements.
// [Pos] Registration gate for Dream running-input queue and independent task-session operations.
// [Sync] 2026-09-27: freeze Registry192-198 while later task-result operations append.
// [Sync] 2026-09-27: register queue, four task-session operations and task navigation without shifting Registry191.
import { expect, it } from "vitest";
import generated198 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { dreamOperations } from "./operationRegistry";
import { identitySchemaRequirement } from "./schemaRequirements";
import { chatInputQueueSchemaRequirement, chatTaskSessionSchemaRequirement, chatThreadSchemaRequirements } from "./chatThreadService";

const names = [
  "chat-input.enqueue", "chat-input.list", "chat-input.transition",
  "task-session.create", "task-session.get", "task-session.links", "task-session.launch",
] as const;
const hashes = [
  "eb7bb85cd5e3726660264d5e8ff7ff94fdfbb7ebd9aa885a63473d74e639e087",
  "d672093facd591589bd2ee3099a9bbc4009b21a28292b1563f6fae38a19d5196",
  "b79ef9d4c8c82de0ae9f7759b06300ac4585a90707661be5d1b5be6afe56edb4",
  "50a550fee373c57761d97b2cd56eada5fd4dfdcad4eaefa846b759ae29dcbefb",
  "442e68f7fd93ae7f285eaf5ccc591d3211fc07fb498c3a73fc53eaa2de127184",
  "f9c1bcfec4308aa6fc8f0bc977a48f34b95cb719b143b0544f6b1178edb7f1b3",
  "03dd117fe923da921eb81f2e22241c6971bbeb3942231f65a5996ca2267e1dcd",
] as const;

it("preserves Registry191 and appends exact queue/task-session contracts", () => {
  expect(generated198).toEqual(dreamOperations);
  const appended = dreamOperations.slice(191, 198);
  expect(appended.map(item => item.contract.name)).toEqual(names);
  expect(appended.map(item => item.capability.contract_sha256)).toEqual(hashes);
  expect(appended.map(item => item.capability.user_scope)).toEqual([
    "dream:write", "dream:read", "dream:write", "dream:write", "dream:read", "dream:read", "dream:write",
  ]);
  for (const operation of appended.slice(0, 3)) {
    expect(operation.requirements).toEqual([
      identitySchemaRequirement, ...chatThreadSchemaRequirements, chatInputQueueSchemaRequirement,
    ]);
  }
  for (const operation of appended.slice(3)) {
    expect(operation.requirements).toEqual([
      identitySchemaRequirement, ...chatThreadSchemaRequirements,
      chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement,
    ]);
  }
});
