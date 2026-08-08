export const IS_DEV = process.env.NODE_ENV !== "production";
export const IS_BROWSER = typeof window !== "undefined";

declare const EdgeRuntime: unknown;
export const IS_EDGE_RUNTIME = typeof EdgeRuntime !== "undefined";

export const IS_VERCEL_ENV = process.env.VERCEL === "1";
export const IS_DOCKER_ENV = process.env.DOCKER_BUILD === "1";

export const BASE_URL = (() => {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;

  if (IS_VERCEL_ENV) {
    const vercelDomain =
      (process.env.VERCEL_ENV === "production"
        ? process.env.VERCEL_PROJECT_PRODUCTION_URL
        : process.env.VERCEL_URL) || process.env.VERCEL_URL;

    if (vercelDomain) return `https://${vercelDomain}`;
  }

  return `http://localhost:${process.env.PORT || 3000}`;
})().replace(/\/+$/, "");
