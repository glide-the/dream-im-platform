import { test, expect } from '@playwright/test';

test.describe('AI Assistant - Customer Creation Flow', () => {
  test('should create customer from AI search - complete flow with real API', async ({ page }) => {
    // 1. 访问 AI 助手页面
    await page.goto('/ai-assistant');
    await page.waitForLoadState('networkidle');

    // 2. 输入查询（使用真实 API）
    await page.fill('[placeholder="输入公司 + 姓名…"]', '零克云 董慧智');
    await page.click('button:has-text("发送")');

    // 3. 等待 AI 生成卡片（真实 API 调用，需要更长时间）
    await page.waitForSelector('text=已生成客户资料卡片', { timeout: 120000 });

    // 4. 验证卡片内容
    await expect(page.locator('text=董慧智')).toBeVisible();
    await expect(page.locator('text=零克云')).toBeVisible();

    // 5. 点击确认新增
    await page.click('button:has-text("确认新增")');

    // 6. 验证成功模态框
    await page.waitForSelector('text=客户已新增', { timeout: 5000 });
    await expect(page.locator('text=客户已新增到系统')).toBeVisible();

    // 7. 点击查看客户详情（跳转新标签页）
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click('button:has-text("查看客户详情")')
    ]);

    // 8. 验证客户详情页
    await newPage.waitForLoadState();
    await expect(newPage).toHaveURL(/\/customers\/cus_/);
    await expect(newPage.locator('h1')).toContainText('董慧智');
    await expect(newPage.locator('text=零克云')).toBeVisible();
  });

  test('should cancel customer creation', async ({ page }) => {
    await page.goto('/ai-assistant');
    await page.waitForLoadState('networkidle');

    await page.fill('[placeholder="输入公司 + 姓名…"]', '测试 李四');
    await page.click('button:has-text("发送")');
    await page.waitForSelector('text=已生成客户资料卡片', { timeout: 120000 });

    // 点击取消
    await page.click('button:has-text("取消")');

    // 验证取消提示
    await page.waitForSelector('text=已取消');

    // 验证客户未创建（跳转到客户列表页搜索）
    await page.goto('/customers');
    await page.fill('[placeholder="搜索客户…"]', '李四');
    await page.waitForTimeout(500);
    await expect(page.locator('text=李四')).not.toBeVisible();
  });
});
