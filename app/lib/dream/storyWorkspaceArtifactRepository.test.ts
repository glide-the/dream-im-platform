// [Input] The original Story-index repository and PostgreSQL SQL parameter encoding.
// [Output] Encodable, stable and workspace/Project-separated transaction lock keys.
// [Pos] Provider-free regression for the production advisory-lock boundary.
// [Sync] 2026-10-26: reject NUL-bearing lock parameters found by the real iOS post-turn index write.
import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DataTransaction } from "./database";
import { StoryWorkspaceArtifactRepository } from "./storyWorkspaceArtifactRepository";

async function lockParameter(workspace: string, project: string) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const repository = new StoryWorkspaceArtifactRepository({ execute } as unknown as DataTransaction);
  await repository.lockIndexKey(workspace, project);
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
  expect(query.sql).toContain("pg_advisory_xact_lock");
  expect(query.params).toHaveLength(1);
  return query.params[0] as string;
}

it("passes PostgreSQL a text lock parameter without NUL bytes", async () => {
  const value = await lockParameter("workspace-one", "project-one");
  expect(value).not.toContain("\0");
  expect(value).toMatch(/^[a-f0-9]{64}$/);
});

it("retains the same lock for a Project and separates workspace and Project identities", async () => {
  const original = await lockParameter("workspace-one", "project-one");
  expect(await lockParameter("workspace-one", "project-one")).toBe(original);
  expect(await lockParameter("workspace-two", "project-one")).not.toBe(original);
  expect(await lockParameter("workspace-one", "project-two")).not.toBe(original);
});
