import { expect, test } from "@playwright/test";

test.describe("Refine admin authentication boundary", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/admin/auth/bootstrap", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { required: false } }),
      });
    });
  });

  test("redirects the protected workspace to the login page", async ({ page }) => {
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(
      page.getByRole("heading", { name: "登录运营控制台" }),
    ).toBeVisible();
    await expect(page.getByLabel("管理员邮箱")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByText("平台用户", { exact: true })).toHaveCount(0);
  });

  test("surfaces a deterministic invalid-login response", async ({ page }) => {
    const pageErrors: string[] = [];
    const loginStatuses: number[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/admin/auth/login"
      ) {
        loginStatuses.push(response.status());
      }
    });
    await page.route("**/api/admin/auth/login", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        email: "operator@example.test",
        password: "not-the-password",
      });
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ADMIN_CREDENTIALS_INVALID",
            message: "The email or password is invalid",
          },
        }),
      });
    });
    await page.goto("/admin/login");
    await page.getByLabel("管理员邮箱").fill("operator@example.test");
    await page.getByLabel("密码").fill("not-the-password");
    await page.getByRole("button", { name: "登录控制台" }).click();

    await expect(page.locator("form [role='alert']")).toHaveText(
      "The email or password is invalid",
    );
    expect(loginStatuses).toEqual([401]);
    expect(pageErrors).toEqual([]);
  });

  test("keeps the narrow login layout usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/login");

    await expect(page.getByRole("heading", { name: "登录运营控制台" })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录控制台" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("redirects the root and leaves removed PWA routes unavailable", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "登录运营控制台" })).toBeVisible();

    expect((await request.get("/customers")).status()).toBe(404);
    expect((await request.get("/api/customers")).status()).toBe(404);
  });
});
