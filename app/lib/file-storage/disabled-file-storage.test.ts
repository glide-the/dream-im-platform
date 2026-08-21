// [Input] Explicitly disabled file-storage driver.
// [Output] Contract evidence that every operation fails without side effects.
// [Pos] Unit contract for the temporary no-storage topology.
// [Sync] 2026-08-21: cover the FILE_STORAGE_DISABLED behavior.
import { describe, expect, it } from "vitest";
import { createDisabledFileStorage } from "./disabled-file-storage";

describe("disabled file storage", () => {
  it("fails every operation with the deployment capability code", async () => {
    const storage = createDisabledFileStorage();
    await expect(storage.exists("uploads/example.txt")).rejects.toThrow("FILE_STORAGE_DISABLED");
    await expect(storage.upload(Buffer.from("example"))).rejects.toThrow("FILE_STORAGE_DISABLED");
  });
});
