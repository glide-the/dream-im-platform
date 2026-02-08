import { test, expect } from "@playwright/test";

test.describe("FileSidebar context menu download", () => {
  test("supports right-click download for files and warns for directories", async ({ page }) => {
    let downloadCallCount = 0;

    await page.route("**/api/workspace/files/download**", async (route) => {
      downloadCallCount += 1;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition":
            "attachment; filename=\"report.txt\"; filename*=UTF-8''report.txt",
        },
        body: "workspace report",
      });
    });

    await page.route("**/api/workspace/files**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === "GET" && url.pathname === "/api/workspace/files") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            files: [
              {
                name: "docs",
                path: "docs",
                isDirectory: true,
                size: 0,
                modifiedAt: new Date("2026-02-08T00:00:00.000Z").toISOString(),
              },
              {
                name: "report.txt",
                path: "files/report.txt",
                isDirectory: false,
                size: 16,
                modifiedAt: new Date("2026-02-08T00:00:00.000Z").toISOString(),
              },
            ],
          }),
        });
        return;
      }

      await route.fallback();
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator('button[title="Files"]').click();

    const fileRow = page.locator('[data-file-path="files/report.txt"]');
    const dirRow = page.locator('[data-file-path="docs"]');
    const contextMenu = page.getByTestId("file-sidebar-context-menu");

    await expect(fileRow).toBeVisible();

    await fileRow.click({ button: "right" });
    await expect(contextMenu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(contextMenu).toBeHidden();

    await fileRow.click({ button: "right" });
    await expect(contextMenu).toBeVisible();
    await page.getByRole("button", { name: "下载文件" }).click();

    await expect.poll(() => downloadCallCount).toBe(1);
    await expect(page.getByText("已开始下载：report.txt")).toBeVisible();

    await dirRow.click({ button: "right" });
    await expect(
      page.getByTestId("file-sidebar-context-menu").getByText("目录暂不支持直接下载。"),
    ).toBeVisible();
  });
});
