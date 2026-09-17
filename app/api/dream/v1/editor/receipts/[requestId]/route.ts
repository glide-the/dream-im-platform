// [Input] Original Editor replace request ID and the same Session-bound bearer.
// [Output] Committed/absent receipt; absence never triggers an automatic write.
// [Pos] Thin public Editor recovery ingress.
import { handlePublicEditorReceipt } from "../../../../../../lib/dream/editorSessionHandler";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) { return handlePublicEditorReceipt(request, (await context.params).requestId); }
