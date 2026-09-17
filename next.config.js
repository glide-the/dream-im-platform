// [Input] Configuration-file location, workspace NodeNext sources, optional E2E dist name and production-build CPU budget.
// [Output] Validated Next.js configuration with stable roots and Webpack TypeScript extension aliases.
// [Pos] Shared Next.js configuration; remote build resources are supplied by deploy config.
// [Sync] 2026-09-16: keep local dev on Webpack so NodeNext .js source specifiers use the same extension aliases as builds.
// [Sync] 2026-09-15: resolve @ink-memory/db NodeNext .js specifiers to workspace TypeScript during Webpack builds.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const e2eDistDir = process.env.INK_ADMIN_E2E_DIST_DIR?.trim();
if (e2eDistDir && !/^\.next-e2e-[a-z0-9-]+$/.test(e2eDistDir)) {
  throw new Error('INK_ADMIN_E2E_DIST_DIR must be a repository-local .next-e2e-* directory');
}
const buildCpusRaw = process.env.NEXT_BUILD_CPUS?.trim();
const buildCpus = buildCpusRaw ? Number(buildCpusRaw) : undefined;
if (buildCpus !== undefined && (!Number.isInteger(buildCpus) || buildCpus < 1 || buildCpus > 64)) {
  throw new Error('NEXT_BUILD_CPUS must be an integer between 1 and 64');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: projectRoot },
  outputFileTracingIncludes: {
    '/api/internal/dream/v1/operations/*': ['./app/lib/dream/deckContentCanonical.py', './app/lib/dream/dreamLaunchEnvelope.py', './app/lib/dream/dreamLaunchFailureEnvelope.py', './app/lib/dream/userSystemConfigCodec.py'],
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
  ...(e2eDistDir && { distDir: e2eDistDir }),
  ...(buildCpus && { experimental: { cpus: buildCpus } }),
  // Enable standalone output for Docker deployments
  // Set NEXT_STANDALONE_OUTPUT=true when building in Docker
  ...(process.env.NEXT_STANDALONE_OUTPUT === 'true' && { output: 'standalone' }),
};

export default nextConfig;
