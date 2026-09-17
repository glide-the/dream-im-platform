// [Input] Public Admin authentication and OAuth requests.
// [Output] Better Auth protocol response from the auth domain boundary.
// [Pos] Thin authentication ingress; SQL/transactions/validation stay in app/lib/auth.
// [Sync] 2026-09-14: add unified authority without a second route-level state machine.
import { handleAuthRequest } from "@/lib/auth/server";
export const runtime = "nodejs";
export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
