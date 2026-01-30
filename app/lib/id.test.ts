import { describe, it, expect } from 'vitest';
import { createId, stableHash } from './id';

describe('createId', () => {
  it('should generate ID with correct prefix format', () => {
    const id = createId('cus');
    expect(id).toMatch(/^cus_[a-z0-9]+_[a-z0-9]+$/);
  });

  it('should include timestamp component', () => {
    const id = createId('test');
    const parts = id.split('_');

    expect(parts).toHaveLength(3);

    // 验证时间戳部分存在且是有效的36进制字符串
    const timestampStr = parts[1];
    expect(timestampStr).toMatch(/^[a-z0-9]+$/);

    // 验证可以转换回数字
    const timestamp = parseInt(timestampStr, 36);
    expect(timestamp).toBeGreaterThan(0);
  });

  it('should generate different values on multiple calls', () => {
    const id1 = createId('cus');
    const id2 = createId('cus');

    expect(id1).not.toBe(id2);
  });

  it('should handle different prefixes', () => {
    const customerId = createId('cus');
    const todoId = createId('todo');
    const conversationId = createId('conv');

    expect(customerId).toMatch(/^cus_/);
    expect(todoId).toMatch(/^todo_/);
    expect(conversationId).toMatch(/^conv_/);
  });
});

describe('stableHash', () => {
  it('should return consistent hash for same input', () => {
    const input = '测试输入';
    const hash1 = stableHash(input);
    const hash2 = stableHash(input);

    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different inputs', () => {
    const hash1 = stableHash('input1');
    const hash2 = stableHash('input2');

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = stableHash('');
    expect(typeof hash).toBe('number');
    expect(hash).toBeGreaterThanOrEqual(0);
  });

  it('should handle unicode characters', () => {
    const hash1 = stableHash('你好世界');
    const hash2 = stableHash('🚀🌟');

    expect(typeof hash1).toBe('number');
    expect(typeof hash2).toBe('number');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle company and name combinations', () => {
    const hash1 = stableHash('腾讯 马化腾');
    const hash2 = stableHash('零克云 董慧智');

    expect(hash1).toBeGreaterThanOrEqual(0);
    expect(hash2).toBeGreaterThanOrEqual(0);
    expect(hash1).not.toBe(hash2);
  });

  it('should be deterministic for same string multiple times', () => {
    const input = 'deterministic test';
    const hashes = Array.from({ length: 100 }, () => stableHash(input));

    expect(hashes.every(h => h === hashes[0])).toBe(true);
  });
});
