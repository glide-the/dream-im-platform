// [Input] Public Images requests and bounded in-memory Provider responses.
// [Output] Central technical resource limits and the exact database capability required by Images routes.
// [Pos] Server-owned Image API policy; values are transport safety limits, not subscription or product entitlements.
// [Sync] 2026-10-09: define the first non-streaming OpenAI/Codex Images safety and schema contract.

export const imageApiPolicy = {
  maxPromptBytes: 1_000_000,
  maxInputImages: 16,
  maxImageBytes: 50 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxMultipartBytes: 64 * 1024 * 1024,
  maxOutputImages: 10,
  maxResponseBytes: 64 * 1024 * 1024,
  schemaCapability: {
    capability: "gateway.images.v1",
    version: 1,
    contractSha256: "073808fc6d828d46266d35ee4d7649477dddddb0e8f0e40351f34d52137b4eed",
  },
} as const;

