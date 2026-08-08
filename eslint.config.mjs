import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { globalIgnores } from "eslint/config";

const eslintConfig = [
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "html/**",
    "coverage/**",
    "test-results/**",
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
