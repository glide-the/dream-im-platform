/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable standalone output for Docker deployments
  // Set NEXT_STANDALONE_OUTPUT=true when building in Docker
  ...(process.env.NEXT_STANDALONE_OUTPUT === 'true' && { output: 'standalone' }),
};

export default nextConfig;
