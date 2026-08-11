const e2eDistDir = process.env.INK_ADMIN_E2E_DIST_DIR?.trim();
if (e2eDistDir && !/^\.next-e2e-[a-z0-9-]+$/.test(e2eDistDir)) {
  throw new Error('INK_ADMIN_E2E_DIST_DIR must be a repository-local .next-e2e-* directory');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(e2eDistDir && { distDir: e2eDistDir }),
  // Enable standalone output for Docker deployments
  // Set NEXT_STANDALONE_OUTPUT=true when building in Docker
  ...(process.env.NEXT_STANDALONE_OUTPUT === 'true' && { output: 'standalone' }),
};

export default nextConfig;
