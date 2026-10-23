// [Input] Frozen v1 operation fingerprints and appended v2 classification DTOs.
// [Output] Registration compatibility, exact v2 gate and strict legacy/version rejection evidence.
// [Pos] Deterministic unit verification; no database, service or model calls.
// [Sync] 2026-10-15: preserve the existing protocol while adding classified-source versions.
import {describe,it,expect} from "vitest";
import {dreamOperations} from "./operationRegistry";
import {artifactDto,artifactV2Dto,settingsV2Dto,memoryV2Operations,baseMemoryOperation} from "./memoryDto";
import {memoryClassificationRequirement,memoryRequirements} from "./memoryService";
const frozen = {
  "memory.artifacts.discover": "0245ca880ea2a0d43e1f4e8be8407e067768264fae3cad42cabd1e333e3924a4",
  "memory.artifacts.claim": "ce408726e5c41a37a0dc64984e1458360340f279c23b5bdb78184844a7d73d60",
  "memory.artifacts.stage": "51e03b4e677e3db1d94e51b3084e024f9e5aca316b1eb3b00f365f17edbb1d05",
  "memory.artifacts.publish": "911758a97922a63d2e4b72d199e2cd8e20ad5e03b701e02110bc488ad1e3d6ab",
  "memory.artifacts.fail": "827cade0fedf532b967df47889e237104f66e2236550f5180d27b6fab7ba92a7",
  "memory.distillations.list": "2fb8909ba8e236201c33eaf94fd7ea526243351dfb5babed9ff1a50215caaccd",
  "memory.distillations.read": "1d47e7cc25967a184dd482b5bc2bf7d1704a379ac77641a978b9cdf9d0887fdf",
  "memory.behavior.get": "296f6d3c2db03dfa394540ad98418823192359c1487f1b9a2f2a7d15c9bf7847",
  "memory.behavior.save": "2fd4eb6c9f6dbe6bdb600ef4681dd4e36ef1105fe896e7e24aa345a6765325d8"
};
describe("versioned memory classification registration",()=>{
 it("keeps all nine v1 descriptor fingerprints unchanged",()=>{
  for(const [name,hash] of Object.entries(frozen)) expect(dreamOperations.find(v=>v.capability.name===name)?.capability.contract_sha256).toBe(hash);
 });
 it("appends nine exact-capability operations without new Agent tools",()=>{
  const added=dreamOperations.filter(v=>v.capability.name.startsWith("memory.v2."));
  expect(added).toHaveLength(9);
  for(const op of added){
   expect(op.requirements).toContainEqual(memoryClassificationRequirement);
   expect(Object.hasOwn(frozen,baseMemoryOperation(op.capability.name as keyof typeof memoryV2Operations))).toBe(true);
  }
  expect(memoryRequirements("memory.artifacts.claim")).toHaveLength(1);
  expect(memoryRequirements("memory.v2.artifacts.claim")).toHaveLength(2);
 });
 it("expands version DTOs explicitly and rejects unknown rule versions",()=>{
  expect(artifactDto.shape.conversion_revision.safeParse("memory-rules-v2").success).toBe(false);
  expect(artifactV2Dto.shape.conversion_revision.parse("memory-rules-v1")).toBe("memory-rules-v1");
  expect(artifactV2Dto.shape.conversion_revision.parse("memory-rules-v2")).toBe("memory-rules-v2");
  expect(artifactV2Dto.shape.conversion_revision.safeParse("memory-rules-v3").success).toBe(false);
  expect(settingsV2Dto.shape.taxonomy_revision.safeParse("memory-rules-v1").success).toBe(false);
 });
});
