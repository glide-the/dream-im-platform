// [Input] Exact Editor stdio opaque bearer and registered load/replace request.
// [Output] Admin-owned Editor DTO; no Runtime service secret or database access.
// [Pos] Thin public Editor ingress.
import { handlePublicEditorOperation } from "../../../../../../lib/dream/editorSessionHandler";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) { return handlePublicEditorOperation(request, (await context.params).operation); }
