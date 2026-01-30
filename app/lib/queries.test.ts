import { describe, it, expect, vi } from 'vitest';
import { queryKeys } from './queries';

describe('Query Keys', () => {
  describe('queryKeys.todos', () => {
    it('should create todos query key with params', () => {
      const key = queryKeys.todos({ page: 1, pageSize: 10 });
      expect(key).toEqual(['todos', { page: 1, pageSize: 10 }]);
    });

    it('should create todos query key with empty params', () => {
      const key = queryKeys.todos();
      expect(key).toEqual(['todos', {}]);
    });

    it('should create todos query key with search and filters', () => {
      const key = queryKeys.todos({
        search: 'test',
        status: 'open',
        priority: 'P1'
      });
      expect(key).toEqual(['todos', {
        search: 'test',
        status: 'open',
        priority: 'P1'
      }]);
    });
  });

  describe('queryKeys.todo', () => {
    it('should create todo query key with id', () => {
      const key = queryKeys.todo('todo_123');
      expect(key).toEqual(['todo', 'todo_123']);
    });
  });

  describe('queryKeys.customers', () => {
    it('should create customers query key with params', () => {
      const key = queryKeys.customers({ page: 1, pageSize: 6 });
      expect(key).toEqual(['customers', { page: 1, pageSize: 6 }]);
    });

    it('should create customers query key with empty params', () => {
      const key = queryKeys.customers();
      expect(key).toEqual(['customers', {}]);
    });

    it('should create customers query key with search and filters', () => {
      const key = queryKeys.customers({
        search: '腾讯',
        tag: '重点跟进',
        hasContact: true
      });
      expect(key).toEqual(['customers', {
        search: '腾讯',
        tag: '重点跟进',
        hasContact: true
      }]);
    });

    it('should handle hasContact boolean correctly', () => {
      const key1 = queryKeys.customers({ hasContact: true });
      const key2 = queryKeys.customers({ hasContact: false });

      expect(key1).toEqual(['customers', { hasContact: true }]);
      expect(key2).toEqual(['customers', { hasContact: false }]);
    });
  });

  describe('queryKeys.customer', () => {
    it('should create customer query key with id', () => {
      const key = queryKeys.customer('cus_123');
      expect(key).toEqual(['customer', 'cus_123']);
    });
  });

  describe('queryKeys.conversations', () => {
    it('should create conversations query key with params', () => {
      const key = queryKeys.conversations({ page: 1, pageSize: 10 });
      expect(key).toEqual(['conversations', { page: 1, pageSize: 10 }]);
    });

    it('should create conversations query key with empty params', () => {
      const key = queryKeys.conversations();
      expect(key).toEqual(['conversations', {}]);
    });

    it('should create conversations query key with status filter', () => {
      const key = queryKeys.conversations({ status: 'pending' });
      expect(key).toEqual(['conversations', { status: 'pending' }]);
    });
  });

  describe('queryKeys.conversation', () => {
    it('should create conversation query key with id', () => {
      const key = queryKeys.conversation('conv_123');
      expect(key).toEqual(['conversation', 'conv_123']);
    });
  });

  describe('queryKeys.searchCustomer', () => {
    it('should create searchCustomer query key with query and context', () => {
      const key = queryKeys.searchCustomer('腾讯 马化腾', ['cus_1', 'cus_2']);
      expect(key).toEqual(['searchCustomer', '腾讯 马化腾', ['cus_1', 'cus_2']]);
    });

    it('should create searchCustomer query key without context', () => {
      const key = queryKeys.searchCustomer('测试客户');
      expect(key).toEqual(['searchCustomer', '测试客户', []]);
    });
  });

  describe('Query key consistency', () => {
    it('should create consistent keys for same params', () => {
      const key1 = queryKeys.todos({ page: 1 });
      const key2 = queryKeys.todos({ page: 1 });

      expect(key1).toEqual(key2);
    });

    it('should create different keys for different params', () => {
      const key1 = queryKeys.todos({ page: 1 });
      const key2 = queryKeys.todos({ page: 2 });

      expect(key1).not.toEqual(key2);
    });
  });
});

// Note: React Query hooks (useCustomers, useTodos, etc.) require React context,
// so they should be tested in integration tests or with a test renderer.
// These tests only validate the query key generation logic.
