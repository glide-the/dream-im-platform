import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { researchCustomer, isAiResearchEnabled } from './ai-researcher';

describe('researchCustomer', () => {
  // 保存原始环境变量
  const originalEnv = process.env;

  beforeEach(() => {
    // 每个测试前重置环境变量
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // 恢复原始环境变量
    process.env = originalEnv;
  });

  describe('正常流程测试', () => {
    it('应该成功获取客户信息（真实 API 调用）', async () => {
      // 测试配置 - 使用 10 轮以提高成功率
      const queryText = '零克云 董慧智';
      const options = {
        maxBudgetUsd: 0.5,  // 增加预算到 $0.5
        maxTurns: 10,       // 使用 10 轮
        timeout: 180000     // 增加到 3 分钟超时
      };

      // 执行测试
      const result = await researchCustomer(queryText, options);

      // 验证返回结构
      expect(result).toBeDefined();
      expect(result.card).toBeDefined();
      expect(result.debug).toBeDefined();

      // 验证 CustomerCard 结构
      const { card } = result;
      expect(card.structured_fields).toBeDefined();
      expect(card.profile_markdown).toBeDefined();
      expect(typeof card.profile_markdown).toBe('string');

      // 验证 debug 信息
      expect(result.debug.name).toBeDefined();
      expect(result.debug.company).toBeDefined();

      // 验证可选字段
      if (card.confidence !== undefined) {
        expect(card.confidence).toBeGreaterThanOrEqual(0);
        expect(card.confidence).toBeLessThanOrEqual(1);
      }

      if (card.sources !== undefined) {
        expect(Array.isArray(card.sources)).toBe(true);
      }
    }, 200_000); // 增加到 3.5 分钟超时（比内部 timeout 多留 20 秒缓冲）
  });
})