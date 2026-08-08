import { describe, expect, it } from "vitest";
import {
  hashAdminPassword,
  validateAdminPassword,
  verifyAdminPassword,
} from "./password";

describe("admin password hashing", () => {
  it("round-trips with scrypt and rejects a different password", async () => {
    const hash = await hashAdminPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    await expect(
      verifyAdminPassword("correct horse battery staple", hash),
    ).resolves.toBe(true);
    await expect(verifyAdminPassword("different password", hash)).resolves.toBe(
      false,
    );
  });

  it("rejects short passwords and malformed hashes", async () => {
    expect(() => validateAdminPassword("too-short")).toThrow(RangeError);
    await expect(verifyAdminPassword("anything", "broken")).resolves.toBe(false);
  });
});
