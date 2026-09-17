// [Input] Registry103 picture DTOs, OAuth actor, repository seams and typed Drizzle projections.
// [Output] Date/range/owner/scope/NULL/timestamp and corrupt-data behavior without a provider.
// [Pos] Deterministic picture-history gate; real filtering and role ACL live in the isolated contract.
// [Sync] 2026-09-15: cover two current-owner reads without friendship or physical selectors.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatThreadActor } from "./chatThreadService";
import type { DataTransaction } from "./database";
import { pictureHistoryOperationContracts as contracts, pictureHistoryListInputDto } from "./pictureHistoryDto";
import { PictureHistoryRepository } from "./pictureHistoryRepository";
import { runPictureHistoryOperation } from "./pictureHistoryService";

const tx = {} as DataTransaction;
const actor: ChatThreadActor = {
  principal: { subject: "picture-subject", canonical_user_id: "9007199254740993", client_id: "dream-browser", scopes: ["dream:read"], status: "active" },
  threadScope: null,
};
const all = { start_date: null, end_date: null, limit: 30 };

afterEach(() => vi.restoreAllMocks());

describe("strict current-owner picture DTO", () => {
  it("accepts null and inclusive ISO date bounds with a zero limit", () => {
    expect(pictureHistoryListInputDto.parse(all)).toEqual(all);
    expect(pictureHistoryListInputDto.parse({ start_date: "2024-02-29", end_date: "2026-09-15", limit: 0 })).toEqual({ start_date: "2024-02-29", end_date: "2026-09-15", limit: 0 });
  });

  it.each(["2026-02-30", "2026-9-15", "2026-09-15T00:00:00Z", "", " 2026-09-15 "])("rejects invalid date %j", date => {
    expect(pictureHistoryListInputDto.safeParse({ ...all, start_date: date }).success).toBe(false);
    expect(contracts["picture-history.full"].input.safeParse({ date }).success).toBe(false);
  });

  it.each(["user_id", "actor", "friend_id", "subject", "scope", "sql", "table", "column"])("rejects caller-authored %s", key => {
    expect(pictureHistoryListInputDto.safeParse({ ...all, [key]: "caller" }).success).toBe(false);
    expect(contracts["picture-history.full"].input.safeParse({ date: "2026-09-15", [key]: "caller" }).success).toBe(false);
  });

  it("rejects negative, fractional and unsafe limits", () => {
    for (const limit of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(pictureHistoryListInputDto.safeParse({ ...all, limit }).success).toBe(false);
  });
});

describe("picture-history service", () => {
  it("passes one exact normalized range to the canonical owner's repository", async () => {
    const result = { pictures: [
      { date: "2026-09-15", base64: "thumbnail", prompt: null, created_at: null },
      { date: "2026-09-14", base64: "full", prompt: "", created_at: "2026-09-14T01:02:03.000001+08:00" },
    ] };
    const list = vi.spyOn(PictureHistoryRepository.prototype, "list").mockResolvedValue(result);
    const input = { start_date: "2026-09-14", end_date: "2026-09-15", limit: 30 };
    expect(await runPictureHistoryOperation("picture-history.list", input, actor, tx)).toEqual(result);
    expect(list).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("returns a full image or explicit null for the current actor", async () => {
    const full = vi.spyOn(PictureHistoryRepository.prototype, "full").mockResolvedValueOnce({ image_base64: "full-new" }).mockResolvedValueOnce({ image_base64: null });
    expect(await runPictureHistoryOperation("picture-history.full", { date: "2026-09-15" }, actor, tx)).toEqual({ image_base64: "full-new" });
    expect(await runPictureHistoryOperation("picture-history.full", { date: "2026-09-14" }, actor, tx)).toEqual({ image_base64: null });
    expect(full.mock.calls).toEqual([["2026-09-15"], ["2026-09-14"]]);
  });

  it("rejects malformed input, missing scope and entity delegation before persistence", async () => {
    const list = vi.spyOn(PictureHistoryRepository.prototype, "list");
    await expect(runPictureHistoryOperation("picture-history.list", { ...all, start_date: "bad" }, actor, tx)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
    await expect(runPictureHistoryOperation("picture-history.list", all, { ...actor, principal: { ...actor.principal, scopes: ["dream:write"] } }, tx)).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
    await expect(runPictureHistoryOperation("picture-history.list", all, { ...actor, threadScope: "other-thread" }, tx)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
    expect(list).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid stored projection", async () => {
    vi.spyOn(PictureHistoryRepository.prototype, "list").mockResolvedValue({ pictures: [{ date: "2026-09-15", base64: 1 }] } as never);
    await expect(runPictureHistoryOperation("picture-history.list", all, actor, tx)).rejects.toMatchObject({ code: "PICTURE_HISTORY_DATA_INVALID", status: 503 });
  });
});

function repositoryTx(rows: unknown[]) {
  const calls: { limits: number[] } = { limits: [] };
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async (limit: number) => { calls.limits.push(limit); return rows; },
  };
  return { tx: { select: () => chain } as unknown as DataTransaction, calls };
}

describe("typed picture repository projection", () => {
  it("preserves nullable prompt and exact PostgreSQL timestamp precision", async () => {
    const { tx: database, calls } = repositoryTx([{ date: "2026-09-15", base64: "thumbnail", prompt: null, created_at: "2026-09-15 08:09:10.123456+08" }]);
    expect(await new PictureHistoryRepository(database, actor.principal.canonical_user_id).list(all)).toEqual({ pictures: [{ date: "2026-09-15", base64: "thumbnail", prompt: null, created_at: "2026-09-15T08:09:10.123456+08:00" }] });
    expect(calls.limits).toEqual([30]);
  });

  it("maps no full row to null and rejects corrupt stored time", async () => {
    const empty = repositoryTx([]).tx;
    expect(await new PictureHistoryRepository(empty, actor.principal.canonical_user_id).full("2026-09-15")).toEqual({ image_base64: null });
    const corrupt = repositoryTx([{ date: "2026-09-15", base64: "image", prompt: null, created_at: "infinity" }]).tx;
    await expect(new PictureHistoryRepository(corrupt, actor.principal.canonical_user_id).list(all)).rejects.toMatchObject({ code: "PICTURE_HISTORY_DATA_INVALID", status: 503 });
  });
});
