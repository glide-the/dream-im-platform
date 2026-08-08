import { expect, test, type Page } from "@playwright/test";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    // Refine probes /api/admin/auth/me before the first login; its expected
    // unauthenticated 401 is not an application failure.
    if (
      message.type() === "error" &&
      !text.includes("server responded with a status of 401")
    ) {
      diagnostics.push(`console: ${text}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (failedRequest) => {
    const reason = failedRequest.failure()?.errorText ?? "failed";
    if (reason !== "net::ERR_ABORTED") {
      diagnostics.push(`${reason}: ${failedRequest.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      diagnostics.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return diagnostics;
}

test.describe("Refine admin bootstrap with isolated PostgreSQL", () => {
  test.skip(
    !bootstrapToken,
    "Set ADMIN_BOOTSTRAP_E2E_TOKEN only for an isolated migrated PostgreSQL lane",
  );

  test("creates one admin, establishes a session, and disables bootstrap", async ({
    context,
    page,
    request,
    baseURL,
  }) => {
    const diagnostics = collectDiagnostics(page);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "设置首位管理员" })).toBeVisible();
    await expect(page.getByLabel("管理员邮箱")).toHaveValue("dmeck@suoxya.com");
    await expect(page.getByLabel("初始密码")).toHaveValue("test123456");

    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: /把模型成本/ })).toBeVisible();

    const secondBootstrap = await request.post(
      `${baseURL}/api/admin/auth/bootstrap`,
      {
        headers: {
          origin: new URL(baseURL!).origin,
          "x-admin-bootstrap-token": bootstrapToken!,
        },
        data: {
          email: "second@example.test",
          displayName: "Second Admin",
          password: "test123456",
        },
      },
    );
    expect(secondBootstrap.status()).toBe(409);
    await expect(secondBootstrap.json()).resolves.toMatchObject({
      error: { code: "ADMIN_ALREADY_BOOTSTRAPPED" },
    });

    expect(diagnostics).toEqual([]);
    await page.close();
    await context.clearCookies();
    const loginPage = await context.newPage();
    const loginDiagnostics = collectDiagnostics(loginPage);
    await loginPage.goto("/admin");
    await expect(loginPage).toHaveURL(/\/admin\/login$/);
    await expect(loginPage.getByRole("heading", { name: "登录运营控制台" })).toBeVisible();
    await loginPage.getByLabel("管理员邮箱").fill("dmeck@suoxya.com");
    await loginPage.getByLabel("密码").fill("test123456");
    await loginPage.getByRole("button", { name: "登录控制台" }).click();

    await expect(loginPage).toHaveURL(/\/admin$/);
    await expect(loginPage.getByRole("heading", { name: /把模型成本/ })).toBeVisible();
    expect(loginDiagnostics).toEqual([]);
  });
});
