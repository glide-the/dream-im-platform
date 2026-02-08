import { test, expect } from "@playwright/test";

const FIXED_TIME = new Date("2026-02-08T00:00:00.000Z").toISOString();

test.describe("FileSidebar refresh behavior", () => {
  test("auto refreshes once when directory changes", async ({ page }) => {
    let listCallCount = 0;

    await page.route("**/api/workspace/files**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === "GET" && url.pathname === "/api/workspace/files") {
        listCallCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            tree: [
              {
                name: "docs",
                path: "docs",
                isDirectory: true,
                size: 0,
                modifiedAt: FIXED_TIME,
                children: [
                  {
                    name: "a.txt",
                    path: "docs/a.txt",
                    isDirectory: false,
                    size: 1,
                    modifiedAt: FIXED_TIME,
                  },
                ],
              },
              {
                name: "root.txt",
                path: "root.txt",
                isDirectory: false,
                size: 4,
                modifiedAt: FIXED_TIME,
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

    await expect(page.getByTestId("workspace-dir-docs")).toBeVisible();
    await expect.poll(() => listCallCount).toBe(1);

    await page.getByTestId("workspace-dir-docs").click();

    await expect(page.locator('[data-file-path="docs/a.txt"]')).toBeVisible();
    await expect.poll(() => listCallCount).toBe(2);
  });

  test("clicking top-right refresh button refreshes current directory", async ({ page }) => {
    let listCallCount = 0;

    await page.route("**/api/workspace/files**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === "GET" && url.pathname === "/api/workspace/files") {
        listCallCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            tree: [
              {
                name: "docs",
                path: "docs",
                isDirectory: true,
                size: 0,
                modifiedAt: FIXED_TIME,
                children: [],
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

    await expect(page.getByTestId("workspace-dir-docs")).toBeVisible();
    await expect.poll(() => listCallCount).toBe(1);

    const refreshButton = page.getByRole("button", { name: "刷新目录" });
    await expect(refreshButton).toBeEnabled();
    await refreshButton.click();

    await expect.poll(() => listCallCount).toBe(2);
  });

  test("shows loading and error state without breaking existing content", async ({ page }) => {
    let listCallCount = 0;

    await page.route("**/api/workspace/files**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === "GET" && url.pathname === "/api/workspace/files") {
        listCallCount += 1;

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1200);
        });

        if (listCallCount === 2) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: "目录服务异常",
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            tree: [
              {
                name: "readme.md",
                path: "readme.md",
                isDirectory: false,
                size: 12,
                modifiedAt: FIXED_TIME,
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

    const refreshButton = page.getByRole("button", { name: "刷新目录" });

    await expect(page.getByTestId("directory-refresh-spinner")).toBeVisible();
    await expect(refreshButton).toBeDisabled();

    await expect(page.locator('[data-file-path="readme.md"]')).toBeVisible();
    await expect(refreshButton).toBeEnabled();

    await refreshButton.click();

    await expect(page.getByTestId("directory-refresh-spinner")).toBeVisible();
    await expect(refreshButton).toBeDisabled();
    await expect.poll(() => listCallCount).toBe(2);

    await expect(page.getByText("目录服务异常")).toBeVisible();
    await expect(refreshButton).toBeEnabled();

    // Existing list content should remain rendered after refresh failure.
    await expect(page.locator('[data-file-path="readme.md"]')).toBeVisible();
  });
});
