// [Input] Locally hashed Dream bcrypt/Admin scrypt passwords, no user/database credentials.
// [Output] Compatibility evidence for both existing login hash formats and invalid passwords.
// [Pos] Unified authentication credential tests.
// [Sync] 2026-09-14: retain existing password product behavior.
import { describe, expect, it } from "vitest";
import { hash as bcryptHash } from "bcryptjs";
import { hashAdminPassword } from "../admin/password";
import { verifyUnifiedPassword } from "./password";
describe("existing password formats", () => {
  it("accepts existing Dream bcrypt hashes and rejects wrong credentials", async () => {
    const encoded = await bcryptHash("fixture-password", 4);
    expect(await verifyUnifiedPassword({ hash: encoded, password: "fixture-password" })).toBe(true);
    expect(await verifyUnifiedPassword({ hash: encoded, password: "different" })).toBe(false);
  });
  it("accepts explicitly migrated Admin scrypt credentials", async () => {
    const encoded = await hashAdminPassword("fixture-admin-password");
    expect(await verifyUnifiedPassword({ hash: encoded, password: "fixture-admin-password" })).toBe(true);
    expect(await verifyUnifiedPassword({ hash: encoded, password: "different" })).toBe(false);
  });
  it("rejects password-disabled Google identities and malformed hashes", async () => {
    expect(await verifyUnifiedPassword({ hash: "!external-auth", password: "fixture" })).toBe(false);
    expect(await verifyUnifiedPassword({ hash: "$2b$bad", password: "fixture" })).toBe(false);
  });
});
