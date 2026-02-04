import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { serverFileStorage, storageDriver } from "@/lib/file-storage";
import logger from "@/lib/logger";
import { checkStorageConfiguration } from "../route";

export const runtime = "nodejs";

// Constants
const DEFAULT_UPLOAD_EXPIRES_SECONDS = 3600; // 1 hour
const FALLBACK_UPLOAD_URL = "/api/storage/upload";

// Types
interface GenericUploadRequest {
  filename?: string;
  contentType?: string;
}

interface FallbackResponse {
  directUploadSupported: false;
  fallbackUrl: string;
  message: string;
}

// Helpers
function createFallbackResponse(): FallbackResponse {
  return {
    directUploadSupported: false,
    fallbackUrl: FALLBACK_UPLOAD_URL,
    message: "Use multipart/form-data upload to fallbackUrl",
  };
}

function isVercelBlobRequest(body: unknown): body is HandleUploadBody {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as HandleUploadBody).type === "blob.generate-client-token"
  );
}

/**
 * Handles Vercel Blob client upload flow.
 * Generates client token and handles upload completion webhook.
 */
async function handleVercelBlobUpload(
  body: HandleUploadBody,
  request: Request,
  userId: string,
) {
  const jsonResponse = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async () => {
      return {
        allowedContentTypes: undefined, // Allow all file types
        addRandomSuffix: true, // Prevent filename collisions
        tokenPayload: JSON.stringify({
          userId,
          uploadedAt: new Date().toISOString(),
        }),
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      logger.info(`Upload completed: ${blob.url}, pathname: ${blob.pathname}, payload: ${tokenPayload}`);

      try {
        // TODO: Add custom logic here (save to database, send notification, etc.)
        // const { userId } = JSON.parse(tokenPayload);
        // await db.files.create({ url: blob.url, userId });
      } catch (error) {
        logger.error("Error in onUploadCompleted callback: " + String(error));
      }
    },
  });

  return NextResponse.json(jsonResponse);
}

/**
 * Handles generic upload URL request (S3, Local FS, etc.).
 * Returns presigned URL if supported, otherwise returns fallback response.
 */
async function handleGenericUpload(request: GenericUploadRequest) {
  // Check if storage backend supports direct upload
  if (typeof serverFileStorage.createUploadUrl !== "function") {
    logger.info("Storage doesn't support createUploadUrl, using fallback");
    return NextResponse.json(createFallbackResponse());
  }

  const uploadUrl = await serverFileStorage.createUploadUrl({
    filename: request.filename || "file",
    contentType: request.contentType || "application/octet-stream",
    expiresInSeconds: DEFAULT_UPLOAD_EXPIRES_SECONDS,
  });

  if (!uploadUrl) {
    logger.info("Storage returned null, using fallback");
    return NextResponse.json(createFallbackResponse());
  }

  // Provide a public source URL for clients to reference after successful PUT
  const sourceUrl = await serverFileStorage.getSourceUrl(uploadUrl.key);

  return NextResponse.json({
    directUploadSupported: true,
    ...uploadUrl,
    sourceUrl,
  });
}

/**
 * POST /api/storage/upload-url
 * 
 * Upload URL endpoint.
 * Provides optimal upload method based on storage backend:
 * - Vercel Blob: Client token for direct upload
 * - S3: Presigned URL
 * - Others: Fallback to server upload
 * 
 * Request body:
 * - For Vercel Blob: { type: "blob.generate-client-token", ... }
 * - For S3/Generic: { filename?: string, contentType?: string }
 */
export async function POST(request: Request) {
  // Note: Authentication is simplified for this PWA app
  // TODO: In production, implement proper authentication:
  // - Add rate limiting to prevent abuse
  // - Validate user session/token
  // - Associate uploads with authenticated user
  const userId = "anonymous"; // Placeholder for auth

  // Check storage configuration first
  const storageCheck = checkStorageConfiguration();
  if (!storageCheck.isValid) {
    logger.error(`Storage configuration error: ${storageCheck.error}`);

    return NextResponse.json(
      {
        error: storageCheck.error,
        solution: storageCheck.solution,
        storageDriver,
      },
      { status: 500 },
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Route to appropriate handler
    if (isVercelBlobRequest(body)) {
      return await handleVercelBlobUpload(body, request, userId);
    }

    return await handleGenericUpload(body as GenericUploadRequest);
  } catch (error) {
    logger.error("Upload URL generation failed: " + String(error));
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 },
    );
  }
}
