// app/api/workspace/files/route.ts
// Workspace file management API - list, upload, delete, move files in cwd workspace
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import {
  getOrCreateWorkspace,
  getWorkspaceRoot,
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

function withWorkspaceDebugHeaders(response: NextResponse): NextResponse {
  response.headers.set("x-workspace-instance-host", hostname());
  response.headers.set("x-workspace-instance-pid", String(process.pid));
  return response;
}

function normalizeIncomingRelativePath(rawPath: string): string {
  const normalized = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");

  if (!normalized) {
    return "";
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    return "";
  }

  return normalized;
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
    const workspaceRoot = getWorkspaceRoot();
    const workspaceFullPath = join(workspaceRoot, sessionId);
    const workspaceExistedBefore = existsSync(workspaceFullPath);
    const workspacePath = getOrCreateWorkspace(sessionId);
    const files = listWorkspaceFiles(workspacePath, subPath);
    const workspaceCreated = !workspaceExistedBefore;

    const response = NextResponse.json({
      files,
      workspacePath,
      workspaceCreated,
      warning:
        workspaceCreated && subPath
          ? "Workspace was created on this instance while listing a sub-path. This usually indicates non-shared storage or requests hitting different instances."
          : undefined,
    });
    return withWorkspaceDebugHeaders(response);
  } catch (error) {
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list files" },
      { status: 500 }
    );
    return withWorkspaceDebugHeaders(response);
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

    const workspaceRoot = getWorkspaceRoot();
    const workspaceFullPath = join(workspaceRoot, sessionId);
    const workspaceExistedBefore = existsSync(workspaceFullPath);
    const workspacePath = getOrCreateWorkspace(sessionId);
    const workspaceCreated = !workspaceExistedBefore;
    const files = formData
      .getAll("file")
      .filter((value): value is File => value instanceof File);
    const relativePaths = formData
      .getAll("relativePath")
      .map((value) => (typeof value === "string" ? value : ""));
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

    // Process all uploaded files in input order and preserve per-file relativePath.
    for (let index = 0; index < files.length; index += 1) {
      const value = files[index];
      const rawRelativePath = relativePaths[index] || value.name;
      const normalizedRelativePath = normalizeIncomingRelativePath(rawRelativePath);

      if (!normalizedRelativePath) {
        return badRequest(`Invalid relativePath for uploaded file #${index + 1}`);
      }

      const buffer = Buffer.from(await value.arrayBuffer());
      const filePath = targetPath
        ? `${targetPath}/${normalizedRelativePath}`
        : normalizedRelativePath;
      const isSingleFileToFilesDir =
        targetPath === WORKSPACE_DIRS.FILES &&
        !normalizedRelativePath.includes("/");

      if (isSingleFileToFilesDir) {
        const savedFile = saveBufferToWorkspaceFiles({
          workspacePath,
          fileName: value.name,
          mimeType: value.type || "application/octet-stream",
          content: buffer,
        });
        uploadedFiles.push(savedFile.workspacePath);
        uploadedMetadata.push(savedFile);
      } else {
        writeWorkspaceFile(workspacePath, filePath, buffer);
        uploadedFiles.push(filePath);
      }
    }

    if (uploadedFiles.length === 0) {
      return badRequest("No files uploaded");
    }

    const response = NextResponse.json({
      uploaded: uploadedFiles,
      files: uploadedMetadata,
      workspacePath,
      workspaceCreated,
    });
    return withWorkspaceDebugHeaders(response);
  } catch (error) {
    const normalizedError = normalizeWorkspaceFileSyncError(error);
    const response = NextResponse.json(
      {
        error: normalizedError.message,
        code: normalizedError.code,
        details: normalizedError.details,
      },
      { status: normalizedError.status }
    );
    return withWorkspaceDebugHeaders(response);
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

    return withWorkspaceDebugHeaders(NextResponse.json({ deleted: true }));
  } catch (error) {
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
    return withWorkspaceDebugHeaders(response);
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

    return withWorkspaceDebugHeaders(NextResponse.json({ moved: true }));
  } catch (error) {
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : "Move failed" },
      { status: 500 }
    );
    return withWorkspaceDebugHeaders(response);
  }
}
