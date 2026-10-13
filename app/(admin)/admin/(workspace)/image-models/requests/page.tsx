// [Input] Legacy Image request-history bookmark.
// [Output] Redirect to the existing Gateway request log, without an independent records page.
// [Pos] Compatibility navigation only; logs and billing own all request views.
// [Sync] 2026-10-10: remove request history from Image model configuration.

import { redirect } from "next/navigation";

export default function ImageRequestsRedirect() {
  redirect("/admin/gateway/requests");
}
