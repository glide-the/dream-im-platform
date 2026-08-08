import { expect, test } from "@playwright/test";

test.describe("Refine admin first-run setup", () => {
  test("prefills the requested admin and submits through the bootstrap API", async ({ page }) => {
    const requests: Array<{ headers: Record<string, string>; body: unknown }> = [];

    await page.route("**/api/admin/auth/bootstrap", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { required: true } }),
        });
        return;
      }

      requests.push({
        headers: request.headers(),
        body: request.postDataJSON(),
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: { id: "admin_test", email: "dmeck@suoxya.com" },
        }),
      });
    });
    await page.route("**/admin", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Admin ready</title><main>Admin ready</main>",
      });
    });

    await page.goto("/admin/login");

    await expect(page.getByRole("heading", { name: "设置首位管理员" })).toBeVisible();
    await expect(page.getByLabel("管理员邮箱")).toHaveValue("dmeck@suoxya.com");
    await expect(page.getByLabel("初始密码")).toHaveValue("test123456");
    await page.getByLabel("首次启动密钥").fill("bootstrap_secret_for_test");
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();

    await expect(page).toHaveURL(/\/admin$/);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers["x-admin-bootstrap-token"]).toBe(
      "bootstrap_secret_for_test",
    );
    expect(requests[0].body).toEqual({
      email: "dmeck@suoxya.com",
      displayName: "Dmeck",
      password: "test123456",
    });
  });

  test("keeps the first-run card usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/admin/auth/bootstrap", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { required: true } }),
      }),
    );

    await page.goto("/admin/login");

    await expect(page.getByRole("heading", { name: "设置首位管理员" })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建管理员并进入控制台" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
