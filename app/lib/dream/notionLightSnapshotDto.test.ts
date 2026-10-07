// [Input] Current Dream canonical snapshot builder output from a provider-free source oracle.
// [Output] Cross-project strict payload compatibility and body/private/identity failure coverage.
// [Pos] Deterministic source contract gate; no PostgreSQL, credentials, CLI, cache or normal account.
// [Sync] 2026-10-07: ensure DTO tightening accepts actual database and independent-page index shapes.
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { notionLightSnapshotDto } from "./notionLightSnapshotDto";
const dreamRoot = process.env.NOTION_DREAM_SOURCE_ROOT;
const python = process.env.NOTION_DREAM_PYTHON;
it.skipIf(!dreamRoot || !python)("accepts the current Dream builder and rejects body/config/identity corruption", () => {
  if (!dreamRoot || !python) throw Error("Explicit Dream source/Python required for cross-project contract gate");
  const payload=JSON.parse(execFileSync(python,["tests/integration/notionSnapshotBuilderOracle.py",dreamRoot],{encoding:"utf8"}));
  expect(notionLightSnapshotDto.safeParse(payload).success).toBe(true);
  for(const mutate of [(value:Record<string,unknown>)=>{value.index="broken";},(value:Record<string,unknown>)=>{value.databases=42;},
    (value:Record<string,unknown>)=>{value.connector=null;},(value:Record<string,unknown>)=>{value.config={token:"forbidden"};},
    (value:Record<string,unknown>)=>{value.index=[];},
    (value:Record<string,unknown>)=>{(value.identity as Record<string,unknown>).snapshot_version="wrong";},
    (value:Record<string,unknown>)=>{(value.index as Record<string,unknown>[])[0].body="正文";}]) {
    const broken=structuredClone(payload);mutate(broken);expect(notionLightSnapshotDto.safeParse(broken).success).toBe(false);
  }
});
