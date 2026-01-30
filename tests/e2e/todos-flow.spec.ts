import { test, expect } from '@playwright/test';

test.describe('Todo Management', () => {
  test('should create and complete todo', async ({ page }) => {
    await page.goto('/todo');
    await page.waitForLoadState('networkidle');

    // 点击新建待办
    await page.click('button:has-text("新建待办")');

    // 填写表单
    await page.fill('[placeholder="待办标题"]', '测试待办任务');
    await page.selectOption('[data-testid="priority-select"]', 'P1');

    // 保存
    await page.click('button:has-text("保存")');

    // 验证待办创建
    await expect(page.locator('text=测试待办任务')).toBeVisible();

    // 标记完成
    await page.click('[data-testid="todo-checkbox"]');

    // 验证已完成状态
    await expect(page.locator('[data-testid="todo-item"].done')).toBeVisible();
  });

  test('should filter todos by status', async ({ page }) => {
    await page.goto('/todo');
    await page.waitForLoadState('networkidle');

    // 点击"进行中"过滤
    await page.click('button:has-text("进行中")');

    // 验证只显示进行中的待办
    await expect(page.locator('[data-testid="todo-checkbox"]:checked')).not.toBeVisible();
  });
});
