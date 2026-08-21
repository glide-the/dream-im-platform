// [Input] Optional repository-local E2E dist name and configurable production-build CPU budget.
// [Output] Validated Next.js build/runtime configuration.
// [Pos] Shared Next.js configuration; remote build resources are supplied by deploy config.
// [Sync] 2026-08-21: allow low-memory ECS builds to bound Next worker concurrency.
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
  ...(e2eDistDir && { distDir: e2eDistDir }),
  ...(buildCpus && { experimental: { cpus: buildCpus } }),
  // Enable standalone output for Docker deployments
  // Set NEXT_STANDALONE_OUTPUT=true when building in Docker
  ...(process.env.NEXT_STANDALONE_OUTPUT === 'true' && { output: 'standalone' }),
};

export default nextConfig;
