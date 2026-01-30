import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // 全局测试设置
    globals: true,

    // 测试环境：Node.js 环境（与 API 路由一致）
    environment: 'node',

    // 测试设置文件（加载环境变量）
    setupFiles: ['./tests/setup.ts'],

    // 测试文件匹配模式
    include: ['app/**/*.test.ts'],

    // 排除文件（只排除 E2E 测试，集成测试需要包含）
    exclude: ['node_modules', '.next', 'dist', '**/*.e2e.test.ts', '**/*.e2e.ts'],

    // 超时时间（AI 调用可能较慢）
    testTimeout: 120_000, // 120 秒
    hookTimeout: 120_000,

    // 串行执行（避免 API 并发调用导致限流）
    fileParallelism: false,

    // 覆盖率配置
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts'
      ]
    },

    // 报告器
    reporters: ['default', 'html']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app')
    }
  }
});
