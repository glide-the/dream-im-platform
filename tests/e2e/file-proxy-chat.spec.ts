import { test, expect } from "@playwright/test";

function encodeKeySegment(key: string): string {
  const base64 = Buffer.from(key, "utf8").toString("base64");
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `k64_${base64url}`;
}

test.describe("File Proxy in Chat Flow", () => {
  test("uses proxy URL in chat message parts and download link", async ({ page }) => {
    let claudeRequestBody: Record<string, unknown> | null = null;

    await page.route("**/api/storage", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "s3",
          supportsDirectUpload: false,
          isConfigured: true,
        }),
      });
    });

    await page.route("**/api/workspace/files", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploaded: ["files/test.txt"],
          files: [
            {
              type: "workspace-file",
              fileName: "test.txt",
              mimeType: "text/plain",
              size: 11,
              workspacePath: "files/test.txt",
              savedAt: new Date("2026-02-07T00:00:00.000Z").toISOString(),
              hash: "mock-hash",
            },
          ],
        }),
      });
    });

    await page.route("**/api/storage/upload", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          key: "uploads/test.txt",
          metadata: {
            contentType: "text/plain",
            size: 11,
          },
        }),
      });
    });

    await page.route("**/api/claude-agent", async (route) => {
      const requestBody = route.request().postData();
      claudeRequestBody = requestBody
        ? (JSON.parse(requestBody) as Record<string, unknown>)
        : null;

      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "mocked for E2E" }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "添加附件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello world"),
    });

    await expect(page.getByText("test.txt")).toBeVisible();

    await page.getByLabel("聊天输入").fill("proxy test message");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByPlaceholder("继续提问...")).toBeVisible();

    await expect
      .poll(() => claudeRequestBody !== null, { timeout: 10_000 })
      .toBe(true);

    const message = (
      claudeRequestBody as {
        message?: { parts?: Array<{ type: string; url?: string }> };
      }
    ).message;

    expect(message?.parts?.[0]?.type).toBe("file");
    expect(message?.parts?.[0]?.url).toBe(
      `/api/storage/file/${encodeKeySegment("uploads/test.txt")}`,
    );

    const downloadLink = page.getByRole("link", { name: "下载 test.txt" }).first();
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute(
      "href",
      `/api/storage/file/${encodeKeySegment("uploads/test.txt")}?download=1`,
    );
  });
});
