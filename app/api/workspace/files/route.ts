// app/api/workspace/files/route.ts
// Workspace file management API - list, upload, delete, move files in cwd workspace
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateWorkspace,
  listWorkspaceFiles,
  deleteWorkspaceFile,
  moveWorkspaceFile,
  WORKSPACE_DIRS,
  writeWorkspaceFile,
} from "../../../lib/workspace";
import {
  normalizeWorkspaceFileSyncError,
  saveBufferToWorkspaceFiles,
} from "../../../lib/workspace-file-sync";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/workspace/files?sessionId=xxx&path=subdir
 * List files in a workspace directory
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");
  const subPath = searchParams.get("path") || "";

  if (!sessionId) {
    return badRequest("sessionId is required");
  }

  try {
    const workspacePath = getOrCreateWorkspace(sessionId);
    const files = listWorkspaceFiles(workspacePath, subPath);
    return NextResponse.json({ files, workspacePath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list files" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspace/files
 * Upload file(s) to workspace
 * Body: multipart/form-data with file(s) and sessionId
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const sessionId = formData.get("sessionId") as string;
    const targetPath = ((formData.get("path") as string) || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");

    if (!sessionId) {
      return badRequest("sessionId is required");
    }

    const workspacePath = getOrCreateWorkspace(sessionId);
    const uploadedFiles: string[] = [];
    const uploadedMetadata: Array<{
      type: "workspace-file";
      fileName: string;
      mimeType: string;
      size: number;
      workspacePath: string;
      savedAt: string;
      hash?: string;
    }> = [];

    // Process all uploaded files
    for (const [key, value] of formData.entries()) {
      if (key === "file" && value instanceof File) {
        const buffer = Buffer.from(await value.arrayBuffer());
        const shouldSaveToFilesDir = targetPath === WORKSPACE_DIRS.FILES;

        if (shouldSaveToFilesDir) {
          const savedFile = saveBufferToWorkspaceFiles({
            workspacePath,
            fileName: value.name,
            mimeType: value.type || "application/octet-stream",
            content: buffer,
          });
          uploadedFiles.push(savedFile.workspacePath);
          uploadedMetadata.push(savedFile);
        } else {
          const filePath = targetPath ? `${targetPath}/${value.name}` : value.name;
          writeWorkspaceFile(workspacePath, filePath, buffer);
          uploadedFiles.push(filePath);
        }
      }
    }

    if (uploadedFiles.length === 0) {
      return badRequest("No files uploaded");
    }

    return NextResponse.json({
      uploaded: uploadedFiles,
      files: uploadedMetadata,
    });
  } catch (error) {
    const normalizedError = normalizeWorkspaceFileSyncError(error);
    return NextResponse.json(
      {
        error: normalizedError.message,
        code: normalizedError.code,
        details: normalizedError.details,
      },
      { status: normalizedError.status }
    );
  }
}

/**
 * DELETE /api/workspace/files
 * Delete a file or directory from workspace
 * Body: { sessionId, path }
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, path: filePath } = body;

    if (!sessionId || !filePath) {
      return badRequest("sessionId and path are required");
    }

    const workspacePath = getOrCreateWorkspace(sessionId);
    const deleted = deleteWorkspaceFile(workspacePath, filePath);

    if (!deleted) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workspace/files
 * Move/rename a file within workspace
 * Body: { sessionId, fromPath, toPath }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, fromPath, toPath } = body;

    if (!sessionId || !fromPath || !toPath) {
      return badRequest("sessionId, fromPath, and toPath are required");
    }

    const workspacePath = getOrCreateWorkspace(sessionId);
    const moved = moveWorkspaceFile(workspacePath, fromPath, toPath);

    if (!moved) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ moved: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Move failed" },
      { status: 500 }
    );
  }
}
