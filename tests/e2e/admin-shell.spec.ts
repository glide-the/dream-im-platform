import { expect, test } from "@playwright/test";

test.describe("Refine admin route shell", () => {
  test("renders the isolated shell and navigates through the Refine router", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "管理不是入口，是边界。" })).toBeVisible();
    await expect(page.getByText("Refine mounted")).toBeVisible();

    await page.getByTestId("refine-route-probe").click();

    await expect(page).toHaveURL(/\/admin\/compatibility\/route-shell$/);
    await expect(page.getByRole("heading", { name: "动态路由已解析" })).toBeVisible();
    await expect(page.getByTestId("compatibility-route-id")).toHaveText("route-shell");

    await page.getByRole("link", { name: "返回控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("keeps the unconfigured login entry outside the workspace shell", async ({ page }) => {
    await page.goto("/admin/login");

    await expect(page.getByRole("heading", { name: "身份接入尚未配置" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用企业身份继续" })).toBeDisabled();
    await expect(page.getByText("客户", { exact: true })).toHaveCount(0);
  });

  test("does not take over existing PWA routes", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Refine mounted")).toHaveCount(0);

    await page.goto("/customers");
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByRole("heading", { name: "客户" })).toBeVisible();
  });
});
