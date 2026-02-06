import { test, expect } from "@playwright/test";

test.describe("Home File Upload", () => {
  test("clicking + Add opens file chooser once", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    let chooserCount = 0;
    page.on("filechooser", () => {
      chooserCount += 1;
    });

    await page.click("button:has-text('+ Add')");
    await page.waitForTimeout(300);

    expect(chooserCount).toBe(1);
  });
});
