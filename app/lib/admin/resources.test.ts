import { describe, expect, it } from "vitest";
import {
  adminResourcePermission,
  handleAdminResourceList,
} from "./resources";

describe("admin resource registration", () => {
  it("keeps audit logs registered as the system governance resource", () => {
    expect(adminResourcePermission("audit-logs")).toBe("audit.read");
  });

  it("rejects the removed system settings resource", async () => {
    const response = await handleAdminResourceList(
      new Request("http://localhost/api/admin/system-settings"),
      "system-settings",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_RESOURCE_NOT_FOUND" },
    });
  });
});
