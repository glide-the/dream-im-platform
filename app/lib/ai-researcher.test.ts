import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { researchCustomer, isAiResearchEnabled } from './ai-researcher';

// Mock Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}));

describe('isAiResearchEnabled', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return true when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(isAiResearchEnabled()).toBe(true);
  });

  it('should return false when ANTHROPIC_API_KEY is not set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiResearchEnabled()).toBe(false);
  });

  it('should return false when ANTHROPIC_API_KEY is empty string', () => {
    process.env.ANTHROPIC_API_KEY = '';
    expect(isAiResearchEnabled()).toBe(false);
  });
});

describe('researchCustomer', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('正常流程测试', () => {
    it('应该成功获取客户信息（真实 API 调用）', async () => {
      // 设置环境变量
      process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

      if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('Skipping AI integration test - ANTHROPIC_API_KEY not set');
      return;
      }

      // 测试配置
      const queryText = '零克云 董慧智';
      const options = {
        maxBudgetUsd: 0.5,
        maxTurns: 10,
        timeout: 180000
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
    }, 200_000);
  });

  describe('错误处理', () => {
    it('should throw error when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(researchCustomer('测试')).rejects.toThrow(
        'ANTHROPIC_API_KEY environment variable is not set'
      );
    });

    it('should handle timeout gracefully', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      // Mock 超时场景
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      vi.mocked(query).mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          await new Promise(resolve => setTimeout(resolve, 200000));
        }
      } as unknown as ReturnType<typeof query>));

      await expect(
        researchCustomer('测试', { timeout: 1000 })
      ).rejects.toThrow('AI research timeout');
    });
  });
});