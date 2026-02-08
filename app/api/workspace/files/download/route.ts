import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOrCreateWorkspace,
  readWorkspaceFileContent,
  WorkspaceFileAccessError,
} from "@/lib/workspace";
import { buildContentDispositionHeader } from "@/lib/content-disposition";
import { getContentTypeFromFilename } from "@/lib/file-storage/storage-utils";

export const runtime = "nodejs";

const DownloadWorkspaceFileQuerySchema = z.object({
  sessionId: z.string().trim().min(1),
  path: z.string().trim().min(1),
});

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * GET /api/workspace/files/download?sessionId=xxx&path=relative/file.txt
 * Download a workspace file.
 */
export async function GET(request: NextRequest) {
  const query = {
    sessionId: request.nextUrl.searchParams.get("sessionId") ?? "",
    path: request.nextUrl.searchParams.get("path") ?? "",
  };

  const parsed = DownloadWorkspaceFileQuerySchema.safeParse(query);
  if (!parsed.success) {
    return badRequest("sessionId and path are required");
  }

  try {
    const workspacePath = getOrCreateWorkspace(parsed.data.sessionId);
    const file = readWorkspaceFileContent(workspacePath, parsed.data.path);

    const headers = new Headers();
    headers.set("Content-Type", getContentTypeFromFilename(file.fileName));
    headers.set("Content-Length", String(file.size));
    headers.set("Content-Disposition", buildContentDispositionHeader(file.fileName));
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new NextResponse(new Uint8Array(file.content), {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof WorkspaceFileAccessError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Failed to download workspace file" },
      { status: 500 },
    );
  }
}
