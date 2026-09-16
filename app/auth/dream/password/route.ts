// [Input] Dream-rendered email/register form submitted directly by the browser.
// [Output] Admin Better Auth Session followed by the configured Dream PKCE entry.
// [Pos] Thin public Dream credential ingress; DTO/service and Better Auth own all behavior.
// [Sync] 2026-09-17: restore Dream's form without returning credentials or tokens to Dream.
import { dreamBrowserEntryFailure, handleDreamPasswordEntry } from "@/lib/auth/dreamBrowserEntry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return await handleDreamPasswordEntry(request); }
  catch (error) { return dreamBrowserEntryFailure(error); }
}
