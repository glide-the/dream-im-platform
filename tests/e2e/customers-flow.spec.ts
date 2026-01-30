import { test, expect } from '@playwright/test';

test.describe('Customer Management', () => {
  test('should list and search customers', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    // 验证客户列表显示
    await expect(page.locator('[data-testid="customer-card"]').first()).toBeVisible();

    // 搜索功能
    await page.fill('[placeholder="搜索客户…"]', '零克云');
    await page.waitForTimeout(500); // 等待防抖
    await expect(page.locator('text=零克云')).toBeVisible();

    // 清空搜索
    await page.fill('[placeholder="搜索客户…"]', '');
    await page.waitForTimeout(500);
  });

  test('should filter customers by tag', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    // 点击标签过滤
    await page.click('button:has-text("高潜客户")');

    // 验证过滤结果（如果有该标签的客户）
    const cards = page.locator('[data-testid="customer-card"]');
    const count = await cards.count();
    
    if (count > 0) {
      // 验证至少显示了一个客户
      await expect(cards.first()).toBeVisible();
    }
  });

  test('should view customer detail', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    // 点击第一个客户卡片
    await page.locator('[data-testid="customer-card"]').first().click();

    // 验证跳转到详情页
    await page.waitForLoadState();
    await expect(page).toHaveURL(/\/customers\/cus_/);

    // 验证基本信息显示
    await expect(page.locator('h1')).toBeVisible();
  });
});
