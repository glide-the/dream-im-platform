import path from "node:path";
import { z } from "zod";
import { buildContentDispositionHeader } from "@/lib/content-disposition";
import { FileNotFoundError } from "@/lib/errors";
import {
  decodeStorageKeyFromBase64Segment,
  getContentTypeFromFilename,
  serverFileStorage,
  storageDriver,
} from "@/lib/file-storage";
import { checkStorageConfiguration } from "@/lib/file-storage/configuration";
import { withPlatformTransaction } from "@/lib/platform-db";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv", "text/markdown", "application/json",
  "application/zip", "application/x-tar", "application/gzip",
  "audio/mpeg", "audio/wav", "video/mp4", "video/webm",
]);
const listQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(500).optional(),
  mime: z.string().trim().max(200).optional(),
  sort: z.enum(["key", "size", "uploadedAt"]).default("uploadedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
const deleteSchema = z.strictObject({
  confirmKey: z.string().min(1).max(4096),
});

function configurationData() {
  const check = checkStorageConfiguration();
  return {
    driver: storageDriver,
    configured: check.isValid,
    listSupported: typeof serverFileStorage.list === "function",
    error: check.error,
    solution: check.solution,
  };
}

function storageUnavailable() {
  const config = configurationData();
  if (!config.configured) {
    throw new AdminError(
      "ADMIN_STORAGE_NOT_CONFIGURED",
      config.error ?? "Storage is not configured",
      503,
      config,
    );
  }
  return config;
}

function parseListQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = listQuerySchema.safeParse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
    q: params.get("q") ?? undefined,
    mime: params.get("mime") ?? undefined,
    sort: params.get("sort") ?? undefined,
    order: params.get("order") ?? undefined,
  });
  if (!parsed.success) {
    throw new AdminError(
      "ADMIN_STORAGE_QUERY_INVALID",
      "The Storage list query is invalid",
      400,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function handleAdminStorageList(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "storage.read");
    const config = storageUnavailable();
    if (!serverFileStorage.list) {
      throw new AdminError(
        "ADMIN_STORAGE_LIST_UNSUPPORTED",
        "The configured Storage driver does not support object listing",
        503,
        config,
      );
    }
    const query = parseListQuery(request);
    const result = await serverFileStorage.list({ limit: 1_000 });
    const q = query.q?.toLocaleLowerCase();
    const mime = query.mime?.toLocaleLowerCase();
    const filtered = result.files.filter((file) => {
      if (q && !`${file.key} ${file.filename}`.toLocaleLowerCase().includes(q)) {
        return false;
      }
      return !mime || file.contentType.toLocaleLowerCase().startsWith(mime);
    });
    filtered.sort((left, right) => {
      const leftValue =
        query.sort === "size"
          ? left.size
          : query.sort === "key"
            ? left.key
            : left.uploadedAt?.getTime() ?? 0;
      const rightValue =
        query.sort === "size"
          ? right.size
          : query.sort === "key"
            ? right.key
            : right.uploadedAt?.getTime() ?? 0;
      const compared =
        typeof leftValue === "number"
          ? leftValue - Number(rightValue)
          : String(leftValue).localeCompare(String(rightValue));
      return query.order === "asc" ? compared : -compared;
    });
    const start = (query.page - 1) * query.pageSize;
    return Response.json(
      {
        data: filtered.slice(start, start + query.pageSize).map((file) => ({
          ...file,
          id: file.key,
          driver: storageDriver,
        })),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: filtered.length,
          totalPages: Math.ceil(filtered.length / query.pageSize),
          truncated: result.truncated,
        },
        capability: config,
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleAdminStorageUpload(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "storage.write");
    storageUnavailable();
    const form = await request.formData();
    if ([...form.keys()].some((key) => key !== "file")) {
      throw new AdminError(
        "ADMIN_STORAGE_UPLOAD_INVALID",
        "Only the file form field is accepted",
        400,
      );
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      throw new AdminError(
        "ADMIN_STORAGE_UPLOAD_INVALID",
        `A non-empty file up to ${MAX_UPLOAD_BYTES} bytes is required`,
        400,
      );
    }
    const suppliedContentType = file.type.toLowerCase().split(";")[0]?.trim();
    const inferredContentType = getContentTypeFromFilename(file.name);
    const contentType = ALLOWED_UPLOAD_CONTENT_TYPES.has(suppliedContentType)
      ? suppliedContentType
      : ALLOWED_UPLOAD_CONTENT_TYPES.has(inferredContentType)
        ? inferredContentType
        : undefined;
    if (!contentType) {
      throw new AdminError(
        "ADMIN_STORAGE_UPLOAD_TYPE_UNSUPPORTED",
        "The selected file type is not allowed",
        400,
        { suppliedContentType, inferredContentType },
      );
    }
    const uploaded = await serverFileStorage.upload(await file.arrayBuffer(), {
      filename: file.name || "file",
      contentType,
    });
    try {
      await withPlatformTransaction(async (client) => {
        await recordAdminAuditOnClient(client, {
          identity,
          action: "upload",
          resourceType: "storage-resources",
          resourceId: uploaded.key,
          requestId,
          request,
          after: {
            key: uploaded.key,
            filename: uploaded.metadata.filename,
            contentType: uploaded.metadata.contentType,
            size: uploaded.metadata.size,
            driver: storageDriver,
          },
        });
      });
    } catch (error) {
      await serverFileStorage.delete(uploaded.key).catch(() => undefined);
      throw error;
    }
    return Response.json(
      {
        data: {
          id: uploaded.key,
          ...uploaded.metadata,
          driver: storageDriver,
        },
      },
      {
        status: 201,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleAdminStorageGet(
  request: Request,
  encodedKey: string,
) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "storage.read");
    storageUnavailable();
    const key = decodeStorageKeyFromBase64Segment(encodedKey);
    if (!key) {
      throw new AdminError(
        "ADMIN_STORAGE_KEY_INVALID",
        "The Storage object key is invalid",
        400,
      );
    }
    const metadata = await serverFileStorage.getMetadata(key);
    if (!metadata) {
      throw new AdminError(
        "ADMIN_STORAGE_OBJECT_NOT_FOUND",
        "The Storage object does not exist",
        404,
      );
    }
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "preview" || mode === "download") {
      const bytes = await serverFileStorage.download(key);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": metadata.contentType || "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "content-disposition": buildContentDispositionHeader(
            path.posix.basename(key),
            mode === "download" ? "attachment" : "inline",
          ),
          "cache-control": "private, max-age=60",
          "x-content-type-options": "nosniff",
          "x-request-id": requestId,
        },
      });
    }
    return Response.json(
      { data: { id: key, ...metadata, driver: storageDriver } },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleAdminStorageDelete(
  request: Request,
  encodedKey: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "storage.delete");
    storageUnavailable();
    const key = decodeStorageKeyFromBase64Segment(encodedKey);
    if (!key) {
      throw new AdminError(
        "ADMIN_STORAGE_KEY_INVALID",
        "The Storage object key is invalid",
        400,
      );
    }
    const body = await request.json().catch(() => undefined);
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success || parsed.data.confirmKey !== key) {
      throw new AdminError(
        "ADMIN_STORAGE_DELETE_CONFIRMATION_INVALID",
        "The exact Storage object key is required for deletion",
        400,
        parsed.success ? undefined : parsed.error.issues,
      );
    }
    const metadata = await serverFileStorage.getMetadata(key);
    if (!metadata) {
      throw new AdminError(
        "ADMIN_STORAGE_OBJECT_NOT_FOUND",
        "The Storage object does not exist",
        404,
      );
    }
    await serverFileStorage.delete(key);
    await withPlatformTransaction(async (client) => {
      await recordAdminAuditOnClient(client, {
        identity,
        action: "delete",
        resourceType: "storage-resources",
        resourceId: key,
        requestId,
        request,
        before: {
          key,
          filename: metadata.filename,
          contentType: metadata.contentType,
          size: metadata.size,
          driver: storageDriver,
        },
        after: { deleted: true },
      });
    });
    return Response.json(
      { data: { id: key, deleted: true } },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof FileNotFoundError) {
      return adminErrorResponse(
        new AdminError(
          "ADMIN_STORAGE_OBJECT_NOT_FOUND",
          "The Storage object does not exist",
          404,
        ),
        requestId,
      );
    }
    return adminErrorResponse(error, requestId);
  }
}
