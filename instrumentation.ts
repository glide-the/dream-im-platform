// [Input] Next.js server instrumentation initialization and the server-owned trace provider.
// [Output] A request-scoped handle for naming registered Dream operation spans.
// [Pos] Next.js instrumentation entry point for the Node.js runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerDreamOperationTrace } = await import("./app/lib/observability/dreamOperationTrace");
    registerDreamOperationTrace();
  }
}
