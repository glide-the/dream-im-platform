import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { globalIgnores } from "eslint/config";

const eslintConfig = [
  globalIgnores([
    "node_modules/**",
    ".next/**",
    ".next-e2e-*/**",
    "out/**",
    "build/**",
    "packages/db/dist/**",
    "html/**",
    "coverage/**",
    "test-results/**",
    "output/**",
    "playwright-report/**",
    "agent-workspaces/**",
    "next-env.d.ts",
  ]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Ignore specific errors in generated/minified files
      "no-sequences": "off",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];

export default eslintConfig;
// [Input] Authored workspace source and named Next build/E2E/output archive directories.
// [Output] Source-only lint coverage excluding generated bundles, dependencies and reports.
// [Pos] Shared validation boundary; application rules remain identical across all source folders.
