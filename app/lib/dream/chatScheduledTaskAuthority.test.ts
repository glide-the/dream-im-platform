// [Input] Admin signing secret and tampered, expired or wrong-service scheduled bearer.
// [Output] Fail-closed proof before any database identity or message read.
// [Pos] Provider-free scheduled Chat bearer boundary test.
// [Sync] 2026-09-28: reject forged claims and expired tokens without exposing bearer contents.
// [Sync] 2026-10-07: all released authority resolution versions reach token validation; unregistered operations remain denied.
import { afterEach, expect, it, vi } from "vitest";
import { issueScheduledChatAuthority, resolveScheduledChatAuthority } from "./chatScheduledTaskAuthority";
import type { DataTransaction } from "./database";

afterEach(() => vi.unstubAllEnvs());
it.each(["scheduled-trigger.authority.resolve", "scheduled-trigger.v2.authority.resolve", "scheduled-trigger.v3.authority.resolve"])("validates the bearer for released authority operation %s", async operation => {
  await expect(resolveScheduledChatAuthority(null as unknown as DataTransaction, "invalid", operation, "dream-service"))
    .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_REQUIRED", status: 401 });
});
it("requires a configured secret and rejects forged or expired tokens before database access", async () => {
  vi.stubEnv("AUTH_CHAT_SCHEDULE_AUTHORITY_SECRET", "a-valid-server-only-secret-of-at-least-32-bytes");
  const now = Date.now();
  const binding = { trigger_id: "550e8400-e29b-41d4-a716-446655440000", claim_id: "550e8400-e29b-41d4-a716-446655440001",
    service_client_id: "dream-service", auth_user_id: "subject", user_id: "42", source_thread_id: "source", target_thread_id: "target",
    issued_at: now - 1000, expires_at: now + 60_000 };
  const token = issueScheduledChatAuthority(binding);
  const unavailableDatabase = null as unknown as DataTransaction;
  await expect(resolveScheduledChatAuthority(unavailableDatabase, token + "x", "chat-message.persist", "dream-service")).rejects.toThrow("SCHEDULE_AUTHORITY_REQUIRED");
  await expect(resolveScheduledChatAuthority(unavailableDatabase, token, "chat-thread.delete", "dream-service")).rejects.toThrow("SCHEDULE_AUTHORITY_OPERATION_DENIED");
  await expect(resolveScheduledChatAuthority(unavailableDatabase, token, "chat-message.persist", "other-service")).rejects.toThrow("SCHEDULE_AUTHORITY_REQUIRED");
  const expired = issueScheduledChatAuthority({ ...binding, issued_at: now - 120_000, expires_at: now - 60_000 });
  await expect(resolveScheduledChatAuthority(unavailableDatabase, expired, "chat-message.persist", "dream-service")).rejects.toThrow("SCHEDULE_AUTHORITY_REQUIRED");
});
