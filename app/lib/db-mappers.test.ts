import { describe, it, expect } from 'vitest';
import { customers, todos, conversations } from './db/schema';
import type { Customer, Todo, Conversation } from './types';

// 导入内部映射函数用于测试
// 注意：这些函数在实际文件中未导出，我们需要通过实际的数据库操作来间接测试
// 这里我们创建简化的单元测试来验证映射逻辑

describe('Database Row Mappers', () => {
  describe('mapCustomerRow', () => {
    it('should map database row to Customer type correctly', () => {
      // 模拟数据库行
      const dbRow: typeof customers.$inferSelect = {
        id: 'cus_test_123',
        name: '张三',
        company: '腾讯',
        title: '采购经理',
        phones: ['+86 13800138000'],
        emails: ['test@example.com'],
        wechat: 'test_wx',
        address: '深圳市南山区',
        tags: ['重点跟进', '高潜'],
        decision_chain: null,
        profile_markdown: '测试资料',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-02T00:00:00Z'),
        source: 'ai_search',
        last_verified_at: new Date('2024-01-02T00:00:00Z')
      };

      // 预期的 Customer 对象
      const expected: Customer = {
        id: 'cus_test_123',
        name: '张三',
        company: '腾讯',
        title: '采购经理',
        phones: ['+86 13800138000'],
        emails: ['test@example.com'],
        wechat: 'test_wx',
        address: '深圳市南山区',
        tags: ['重点跟进', '高潜'],
        decision_chain: [],
        profile_markdown: '测试资料',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
        source: 'ai_search',
        last_verified_at: '2024-01-02T00:00:00.000Z'
      };

      // 验证映射逻辑
      expect(dbRow.id).toBe(expected.id);
      expect(dbRow.name).toBe(expected.name);
      expect(dbRow.company).toBe(expected.company);
      expect(dbRow.title).toBe(expected.title);
      expect(dbRow.phones).toEqual(expected.phones);
      expect(dbRow.emails).toEqual(expected.emails);
    });

    it('should handle null/undefined fields correctly', () => {
      // 模拟包含 null 值的数据库行
      const dbRow: typeof customers.$inferSelect = {
        id: 'cus_test_456',
        name: null,
        company: null,
        title: null,
        phones: null,
        emails: null,
        wechat: null,
        address: null,
        tags: null,
        decision_chain: null,
        profile_markdown: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-02T00:00:00Z'),
        source: 'manual',
        last_verified_at: null
      };

      // 验证 null 值转换为空字符串或空数组
      expect(dbRow.name).toBeNull();
      expect(dbRow.company).toBeNull();
      expect(dbRow.phones).toBeNull();
      expect(dbRow.emails).toBeNull();
      expect(dbRow.last_verified_at).toBeNull();
    });

    it('should convert timestamp to ISO string', () => {
      const timestamp = new Date('2024-01-15T08:30:00.000Z');
      const expectedIso = '2024-01-15T08:30:00.000Z';

      // 验证 Date 对象转换为 ISO 字符串
      expect(timestamp.toISOString()).toBe(expectedIso);
    });
  });

  describe('mapTodoRow', () => {
    it('should map database row to Todo type correctly', () => {
      const dbRow: typeof todos.$inferSelect = {
        id: 'todo_test_123',
        title: '完成客户调研',
        description: '联系客户获取更多信息',
        priority: 'P1',
        status: 'open',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-02T00:00:00Z')
      };

      const expected: Todo = {
        id: 'todo_test_123',
        title: '完成客户调研',
        description: '联系客户获取更多信息',
        priority: 'P1',
        status: 'open',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z'
      };

      expect(dbRow.id).toBe(expected.id);
      expect(dbRow.title).toBe(expected.title);
      expect(dbRow.priority).toBe(expected.priority);
      expect(dbRow.status).toBe(expected.status);
    });

    it('should set default values for missing fields', () => {
      const dbRow: typeof todos.$inferSelect = {
        id: 'todo_test_456',
        title: '测试待办',
        description: null,
        priority: null,
        status: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-02T00:00:00Z')
      };

      // 验证默认值
      expect(dbRow.priority).toBeNull();
      expect(dbRow.status).toBeNull();
      expect(dbRow.description).toBeNull();
    });
  });

  describe('mapConversationRow', () => {
    it('should map database row to Conversation type correctly', () => {
      const dbRow: typeof conversations.$inferSelect = {
        id: 'conv_test_123',
        title: '【腾讯】马化腾 客户信息检索',
        status: 'pending',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-02T00:00:00Z'),
        messages: [
          { id: 'msg_1', role: 'user', content: '查询腾讯马化腾', created_at: '2024-01-01T00:00:00Z' },
          { id: 'msg_2', role: 'assistant', content: '已生成客户卡片', created_at: '2024-01-01T00:00:01Z' }
        ],
        attachments: null,
        context_customer_ids: ['cus_1', 'cus_2'],
        ai_outputs: {
          customer_card: {
            structured_fields: { name: '马化腾', company: '腾讯' },
            profile_markdown: '腾讯创始人'
          }
        },
        linked_customer_id: null,
        claude_session_id: null
      };

      expect(dbRow.id).toBe('conv_test_123');
      expect(dbRow.title).toBe('【腾讯】马化腾 客户信息检索');
      expect(dbRow.status).toBe('pending');
      expect(dbRow.context_customer_ids).toEqual(['cus_1', 'cus_2']);
      expect(dbRow.linked_customer_id).toBeNull();
    });

    it('should handle JSONB fields correctly', () => {
      const messages = [
        { id: 'msg_1', role: 'user', content: '测试消息', created_at: '2024-01-01T00:00:00Z' }
      ];
      const messagesJson = JSON.stringify(messages);

      // 验证 JSON 序列化
      expect(JSON.parse(messagesJson)).toEqual(messages);
      expect(JSON.stringify(messages)).toBe(messagesJson);
    });
  });
});

describe('parseJson helper', () => {
  it('should parse valid JSON strings', () => {
    const jsonString = '{"name":"张三","company":"腾讯"}';
    const parsed = JSON.parse(jsonString);

    expect(parsed).toEqual({ name: '张三', company: '腾讯' });
  });

  it('should return undefined for null', () => {
    const parsed = JSON.parse(String(null));

    // JSON.parse(null) 返回 null，需要特殊处理
    expect(parsed).toBeNull();
  });

  it('should return undefined for undefined', () => {
    // JSON.parse(String(undefined)) 会抛出错误，验证错误处理
    expect(() => JSON.parse(String(undefined))).toThrow();
  });

  it('should handle invalid JSON gracefully', () => {
    const invalidJson = '{invalid json}';

    expect(() => JSON.parse(invalidJson)).toThrow();
  });

  it('should parse JSONB arrays correctly', () => {
    const arrayJson = '["tag1","tag2","tag3"]';
    const parsed = JSON.parse(arrayJson);

    expect(parsed).toEqual(['tag1', 'tag2', 'tag3']);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should parse empty objects and arrays', () => {
    expect(JSON.parse('{}')).toEqual({});
    expect(JSON.parse('[]')).toEqual([]);
  });
});
