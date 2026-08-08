import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['app/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist', '**/*.e2e.test.ts', '**/*.e2e.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
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
