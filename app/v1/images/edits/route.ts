// [Input] Authorized OpenAI-compatible multipart Image edit requests.
// [Output] Fully settled base64 Image edit responses.
// [Pos] Thin public Route Handler delegating to the Images Gateway domain.
// [Sync] 2026-10-09: expose POST /v1/images/edits.

import { handleImageEdit } from "../../../lib/gateway/image-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleImageEdit;
