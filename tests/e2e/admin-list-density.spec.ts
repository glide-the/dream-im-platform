import { expect, test, type Page } from "@playwright/test";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("server responded with a status of 401")) {
      diagnostics.push(`console: ${text}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "failed";
    if (reason !== "net::ERR_ABORTED") diagnostics.push(`${reason}: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

async function bootstrapAdmin(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("显示名称").fill("List Density QA");
  await page.getByLabel("管理员邮箱").fill("list-density@example.test");
  await page.getByLabel("初始密码").fill("List-density-admin-2026!");
  await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
  await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe("compact admin list chrome", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!bootstrapToken, "Run only with an owned isolated PostgreSQL database");

  test("keeps filters compact and preserves draft state across desktop and mobile folds", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    const diagnostics = collectDiagnostics(page);
    await bootstrapAdmin(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/gateway/requests");
    await expect(page.getByRole("heading", { name: "请求日志", exact: true })).toBeVisible();
    const desktopToggle = page.getByRole("button", { name: "展开筛选", exact: true });
    await expect(desktopToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("用户邮箱")).toBeHidden();

    await desktopToggle.click();
    await expect(page.getByRole("button", { name: "收起筛选", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.getByLabel("用户邮箱").fill("density@example.test");
    await expect(page.getByText("有未应用更改", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.getByText("已应用 1 项", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /收起筛选/ }).click();
    await expect(page.getByLabel("用户邮箱")).toBeHidden();
    await page.getByRole("button", { name: /展开筛选/ }).click();
    await expect(page.getByLabel("用户邮箱")).toHaveValue("density@example.test");

    await page.goto("/admin/access/admins");
    await expect(page.getByRole("heading", { name: "管理员", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "展开筛选", exact: true }).click();
    await page.getByLabel("Email").fill("list-density@example.test");
    await expect(page.getByText("有未应用更改", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/gateway/requests");
    await page.getByRole("button", { name: "展开筛选", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "筛选" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("用户邮箱").fill("mobile@example.test");
    await dialog.getByRole("button", { name: "关闭筛选", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("有未应用更改", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "展开筛选", exact: true }).click();
    await expect(dialog.getByLabel("用户邮箱")).toHaveValue("mobile@example.test");
    await dialog.getByRole("button", { name: "关闭筛选", exact: true }).click();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(diagnostics).toEqual([]);
  });
});
