import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
  list: vi.fn(),
  upload: vi.fn(),
  getMetadata: vi.fn(),
  download: vi.fn(),
  delete: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "storage-request",
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock("./audit", () => ({ recordAdminAuditOnClient: mocks.audit }));

vi.mock("@/lib/platform-db", () => ({
  withPlatformTransaction: async (handler: (client: object) => Promise<unknown>) =>
    await handler({ query: vi.fn() }),
}));

vi.mock("@/lib/file-storage/configuration", () => ({
  checkStorageConfiguration: () => ({ isValid: true }),
}));

vi.mock("@/lib/file-storage", () => ({
  storageDriver: "s3",
  decodeStorageKeyFromBase64Segment: () => "docs/a.pdf",
  getContentTypeFromFilename: (filename: string) =>
    filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
  serverFileStorage: {
    list: mocks.list,
    upload: mocks.upload,
    getMetadata: mocks.getMetadata,
    download: mocks.download,
    delete: mocks.delete,
  },
}));

import { AdminError } from "./errors";
import {
  handleAdminStorageDelete,
  handleAdminStorageList,
  handleAdminStorageUpload,
} from "./storage-resources";

const identity = {
  id: "admin-1",
  email: "operator@example.com",
  displayName: "Operator",
  roles: ["operator"],
  permissions: ["storage.read", "storage.write", "storage.delete"],
};

describe("Admin Storage resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue(identity);
    mocks.audit.mockResolvedValue(undefined);
  });

  it("lists and paginates objects behind storage.read", async () => {
    mocks.list.mockResolvedValue({
      files: [
        { key: "docs/a.pdf", filename: "a.pdf", contentType: "application/pdf", size: 120, uploadedAt: new Date("2026-08-08T00:00:00Z") },
        { key: "images/b.png", filename: "b.png", contentType: "image/png", size: 220, uploadedAt: new Date("2026-08-07T00:00:00Z") },
      ],
      truncated: false,
    });

    const response = await handleAdminStorageList(
      new Request("http://localhost/api/admin/storage-resources?page=1&pageSize=1&mime=application/pdf"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "storage.read");
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).not.toHaveProperty("sourceUrl");
  });

  it("returns 403 when storage.read is missing", async () => {
    mocks.requireAdminRequest.mockRejectedValueOnce(
      new AdminError("ADMIN_PERMISSION_DENIED", "Permission storage.read is required", 403),
    );
    const response = await handleAdminStorageList(
      new Request("http://localhost/api/admin/storage-resources"),
    );
    expect(response.status).toBe(403);
  });

  it("uploads an allowed file and writes an audit", async () => {
    mocks.upload.mockResolvedValue({
      key: "docs/a.pdf",
      sourceUrl: "https://storage.invalid/a.pdf",
      metadata: { key: "docs/a.pdf", filename: "a.pdf", contentType: "application/pdf", size: 3 },
    });
    const form = new FormData();
    form.set("file", new File(["pdf"], "a.pdf", { type: "application/pdf" }));
    const response = await handleAdminStorageUpload(
      new Request("http://localhost/api/admin/storage-resources", { method: "POST", body: form }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "storage.write");
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(body.data).not.toHaveProperty("sourceUrl");
  });

  it("requires an exact key before deletion", async () => {
    const response = await handleAdminStorageDelete(
      new Request("http://localhost/api/admin/storage-resources/key", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmKey: "wrong" }),
      }),
      "key",
    );
    expect(response.status).toBe(400);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
