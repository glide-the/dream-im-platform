// [Input] Dream-rendered Google form submitted directly by the browser.
// [Output] Official Better Auth Google authorization redirect and state cookie.
// [Pos] Thin public Dream Google ingress; provider callback and Session remain Admin-owned.
// [Sync] 2026-09-17: provide one-click Google entry from Dream's restored login card.
import { dreamBrowserEntryFailure, handleDreamGoogleEntry } from "@/lib/auth/dreamBrowserEntry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return await handleDreamGoogleEntry(request); }
  catch (error) { return dreamBrowserEntryFailure(error); }
}
