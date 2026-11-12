// [Input] Opaque public share token only.
// [Output] Cache-free text snapshot after current server-side active-state validation.
// [Pos] Anonymous snapshot ingress; no account cookie or user identifier is required.
import {handlePublicExternalShare} from '../../../../lib/dream/externalShareHandler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: {params: Promise<{token: string}>}) {return handlePublicExternalShare((await context.params).token);}
