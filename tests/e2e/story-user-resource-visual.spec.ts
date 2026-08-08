import { expect, test, type Page } from "@playwright/test";

const email = "super-admin@example.test";
const password = "Test-super-admin-2026!";

function diagnosticsFor(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("server responded with a status of 401")) diagnostics.push(`console: ${text}`);
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

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("captures Story, User and Storage admin at both target viewports", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const diagnostics = diagnosticsFor(page);
  await page.goto("/admin/login");
  await page.getByLabel("管理员邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const target of [
    { path: "/admin/resources/users", heading: "平台用户", shot: "platform-users-desktop-1440x1000.png" },
    { path: "/admin/story/workspaces", heading: "工作区", shot: "story-workspaces-desktop-1440x1000.png" },
    { path: "/admin/story/stories", heading: "剧本", shot: "stories-desktop-1440x1000.png" },
    { path: "/admin/resources/storage", heading: "文件存储", shot: "storage-desktop-1440x1000.png" },
  ]) {
    await page.goto(target.path);
    await expect(page.getByRole("heading", { name: target.heading, exact: true }).first()).toBeVisible();
    if (target.path === "/admin/resources/storage") {
      await expect(page.getByText("正在读取文件…")).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("s3", { exact: true })).toBeVisible();
    }
    await assertNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(target.shot), fullPage: true, caret: "initial" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/story/stories");
  await expect(page.getByRole("heading", { name: "剧本", exact: true }).first()).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("stories-mobile-390x844.png"), caret: "initial" });

  const menu = page.getByRole("button", { name: "菜单" });
  await menu.focus();
  await menu.press("Enter");
  await expect(page.getByRole("dialog", { name: "管理后台导航" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "管理后台导航" }).getByRole("link", { name: "文件存储" })).toBeVisible();
  await assertNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("module-navigation-mobile-390x844.png"), caret: "initial" });

  expect(diagnostics).toEqual([]);
});
