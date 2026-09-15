// [Input] Production current-user service with injected owned profile repository.
// [Output] Exact bigint/microseconds/provider projection and scope/not-found failures.
// [Pos] Provider-free current profile domain tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("./userProfileRepository", () => ({ UserProfileRepository: class { current = mocks.current; } }));
import { currentUserProfile } from "./userProfileService";
import type { DataTransaction } from "./database";
const tx = {} as DataTransaction, principal = { subject: "auth-user", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const };
beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ profile: { id: principal.canonical_user_id, email: "user@example.test", display_name: null, avatar_url: null, role: "user", created_at: "2026-09-14 00:00:00.123456+00", updated_at: null }, providers: ["google", "credential", "google"] }); });
describe("current OAuth owner profile", () => {
  it("projects exact owner identity and preserves PG microseconds/null without hashes", async () => {
    expect(await currentUserProfile(tx, principal)).toEqual({ user: { id: principal.canonical_user_id, email: "user@example.test", display_name: null, avatar_url: null, role: "user", created_at: "2026-09-14T00:00:00.123456+00:00", updated_at: null, auth_providers: ["google", "credential"] } });
    expect(mocks.current).toHaveBeenCalledWith(principal.canonical_user_id, principal.subject);
  });
  it("refuses missing scope before repository use and unavailable owner", async () => {
    await expect(currentUserProfile(tx, { ...principal, scopes: ["product:read"] })).rejects.toMatchObject({ status: 403 }); expect(mocks.current).not.toHaveBeenCalled();
    mocks.current.mockResolvedValue(null); await expect(currentUserProfile(tx, principal)).rejects.toMatchObject({ status: 404 });
  });
});
