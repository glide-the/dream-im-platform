// [Input] Google callback forwarded by the Alibaba edge with its bounded query moved to an internal transport header.
// [Output] The canonical Better Auth Google callback result with a bounded explicit redirect body for the HTTP relay.
// [Pos] Transport alias only; Better Auth remains the sole state, PKCE, account, and Session authority.
// [Sync] 2026-09-18: restore the callback query after the second Cloudflare hop and normalize successful redirect framing.
import { handleAuthRequest } from "@/lib/auth/server";

export const runtime = "nodejs";

const callbackQueryHeader = "x-ink-google-callback-query";

function hasControlCharacter(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export async function GET(request: Request) {
  const canonical = new URL(request.url);
  canonical.pathname = "/api/auth/callback/google";
  const relayedQuery = request.headers.get(callbackQueryHeader);
  if (relayedQuery !== null) {
    const maximum = Number(process.env.AUTH_MAX_CALLBACK_QUERY_BYTES ?? 8_192);
    if (!Number.isSafeInteger(maximum) || maximum < 1 || canonical.search || !relayedQuery
      || Buffer.byteLength(relayedQuery) > maximum || hasControlCharacter(relayedQuery)) {
      return Response.json({ error: { code: "AUTH_CALLBACK_TRANSPORT_INVALID" } }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    canonical.search = relayedQuery;
  }
  const headers = new Headers(request.headers);
  headers.delete(callbackQueryHeader);
  const response = await handleAuthRequest(new Request(canonical, { method: request.method, headers, signal: request.signal }));
  if (response.status < 300 || response.status >= 400) return response;

  const body = "Redirecting";
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.set("content-length", String(Buffer.byteLength(body)));
  responseHeaders.set("content-type", "text/plain; charset=utf-8");
  return new Response(body, { status: response.status, headers: responseHeaders });
}
