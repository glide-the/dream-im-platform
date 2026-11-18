// [Input] Registered operation and source-only metadata for Admin request processing.
// [Output] Concrete HTTP route and named child spans on the server-owned trace.
// [Pos] Optional tracing at the Dream operation ingress and domain boundaries.
import { context, createContextKey, SpanStatusCode, trace, type Attributes, type Span } from "next/dist/compiled/@opentelemetry/api";
import { getTracer } from "next/dist/server/lib/trace/tracer";

type RequestTrace = {
  span: Span;
  attributes: NonNullable<ReturnType<ReturnType<typeof getTracer>["getRootSpanAttributes"]>>;
};
const requestTraceKey = createContextKey("ink-memory-admin.dream.request");
const installedKey = Symbol.for("ink-memory-admin.dream.request-trace-installed");
const operationPrefix = "/api/internal/dream/v1/operations/";

export function registerDreamOperationTrace(): void {
  const tracer = getTracer();
  if (Reflect.has(tracer, installedKey)) return;
  const original = tracer.trace.bind(tracer);
  // Next's child scopes replace its private request attribute key. Capture
  // the request scope before that happens so the finalizer sees the new route.
  tracer.trace = ((type: string, ...args: unknown[]) => {
    const request = type === "BaseServer.handleRequest" ? (args[0] as { attributes?: Attributes } | undefined)?.attributes : undefined;
    if (request?.["http.method"] === "POST" && typeof request["http.target"] === "string"
      && request["http.target"].startsWith(operationPrefix) && typeof args[1] === "function") {
      const invoke = args[1] as (span?: Span) => unknown;
      args[1] = (span?: Span) => {
        const attributes = tracer.getRootSpanAttributes();
        if (!span?.isRecording() || !attributes) return invoke(span);
        const requestTrace: RequestTrace = { span, attributes };
        return context.with(context.active().setValue(requestTraceKey, requestTrace), invoke, undefined, span);
      };
    }
    return Reflect.apply(original, undefined, [type, ...args]);
  }) as typeof tracer.trace;
  Reflect.set(tracer, installedKey, true);
}

export function nameDreamOperationTrace(operation: string): void {
  try {
    const requestTrace = context.active().getValue(requestTraceKey) as RequestTrace | undefined;
    if (requestTrace) {
      requestTrace.attributes.set("next.route", operationPrefix + operation);
      requestTrace.span.setAttribute("ink.dream.operation", operation);
    }
  } catch {
    // Tracing is optional for operation dispatch.
  }
}

export async function traceDreamOperationStep<T>(
  name: string,
  file: string,
  run: () => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  if (!trace.getActiveSpan()?.isRecording()) return run();

  return trace.getTracer("ink-memory-admin.dream").startActiveSpan(name, {
    attributes: { ...attributes, "code.function.name": name, "code.file.path": file },
  }, async (span: Span) => {
    try {
      return await run();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
