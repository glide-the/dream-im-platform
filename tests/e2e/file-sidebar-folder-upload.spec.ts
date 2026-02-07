import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test.describe("FileSidebar folder upload", () => {
  test("selecting a folder uploads nested files and does not stay stuck in uploading", async ({ page }) => {
    const tempDir = await mkdtemp(join(tmpdir(), "folder-upload-e2e-"));
    const rootFolder = join(tempDir, "design-skill");
    const nestedFolder = join(rootFolder, "sub");

    await mkdir(nestedFolder, { recursive: true });
    await writeFile(join(rootFolder, "a.txt"), "A", "utf8");
    await writeFile(join(nestedFolder, "b.txt"), "B", "utf8");

    let postCallCount = 0;

    try {
      await page.route("**/api/workspace/files**", async (route) => {
        const method = route.request().method();

        if (method === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ files: [] }),
          });
          return;
        }

        if (method === "POST") {
          postCallCount += 1;

          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              uploaded: ["design-skill/a.txt", "design-skill/sub/b.txt"],
              files: [],
            }),
          });
          return;
        }

        await route.fallback();
      });

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await page.locator('button[title="Files"]').click();

      const folderInput = page.locator('input[type="file"][webkitdirectory]').first();
      await folderInput.setInputFiles(rootFolder);

      await expect
        .poll(() => postCallCount, { timeout: 20_000 })
        .toBeGreaterThan(0);

      await expect(
        page.getByText(/pending\s+0\s+·\s+uploading\s+0\s+·\s+success\s+2\s+·\s+error\s+0/),
      ).toBeVisible({ timeout: 20_000 });

      await expect(page.getByText("正在上传...")).toHaveCount(0);
      await expect(page.getByText("上传超时，请重试或减少单次上传文件数量。")).toHaveCount(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
