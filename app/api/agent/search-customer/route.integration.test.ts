import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { createId } from '../../../lib/id';
import { listConversations, createCustomer } from '../../../lib/db';
import { setup, teardown, beforeEachTest, afterEachTest } from '../../../../tests/setup';

// Helper function to create mock request
function createMockRequest(body: any) {
  return new Request('http://localhost:3000/api/agent/search-customer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent/search-customer', () => {
  beforeAll(async () => {
    await setup();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await beforeEachTest();
  });

  afterEach(async () => {
    await afterEachTest();
  });

  describe('AI 检索功能 - 真实 API 测试', () => {
    it('should research 零克云 董慧智 successfully with real AI API', async () => {
      const response = await POST(
        createMockRequest({ query_text: '零克云 董慧智' })
      );

      expect(response.status).toBe(200);
      const json = await response.json();

      // 验证响应结构
      expect(json).toHaveProperty('conversation_id');
      expect(json).toHaveProperty('customer_card');
      expect(json).toHaveProperty('action_suggestions');
      expect(json).toHaveProperty('research_method', 'ai');

      // 验证 conversation_id 格式
      expect(json.conversation_id).toMatch(/^conv_/);

      // 验证 CustomerCard 结构
      expect(json.customer_card).toHaveProperty('structured_fields');
      expect(json.customer_card).toHaveProperty('profile_markdown');
      expect(json.customer_card.structured_fields).toHaveProperty('name');
      expect(json.customer_card.structured_fields).toHaveProperty('company');

      // 验证检索到了正确的人物
      expect(json.customer_card.structured_fields.name).toContain('董慧智');
      expect(json.customer_card.structured_fields.company).toContain('零克云');

      // 验证数据库中创建了 conversation
      const conversations = await listConversations({});
      const created = conversations.data.find(c => c.id === json.conversation_id);
      expect(created).toBeDefined();
      expect(created?.status).toBe('pending');
    }, 120000); // 2分钟超时
  });
});
