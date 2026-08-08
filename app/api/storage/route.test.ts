import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importRoute = async () => await import("./route");

describe("GET /api/storage", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.FILE_STORAGE_TYPE;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.FILE_STORAGE_S3_BUCKET;
    delete process.env.FILE_STORAGE_S3_REGION;
    delete process.env.AWS_REGION;
  });

  it("returns storage info with default driver (vercel-blob)", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    const { GET } = await importRoute();
    const response = await GET();
    const data = await response.json();
    
    expect(data.type).toBe("vercel-blob");
    expect(data.supportsDirectUpload).toBe(true);
    expect(data.isConfigured).toBe(true);
  });

  it("returns error when vercel-blob missing token", async () => {
    process.env.FILE_STORAGE_TYPE = "vercel-blob";
    const { GET } = await importRoute();
    const response = await GET();
    const data = await response.json();
    
    expect(data.isConfigured).toBe(false);
    expect(data.error).toMatch(/BLOB_READ_WRITE_TOKEN/);
  });

  it("returns s3 driver info when configured", async () => {
    process.env.FILE_STORAGE_TYPE = "s3";
    process.env.FILE_STORAGE_S3_BUCKET = "bucket";
    process.env.FILE_STORAGE_S3_REGION = "us-east-1";
    const { GET } = await importRoute();
    const response = await GET();
    const data = await response.json();
    
    expect(data.type).toBe("s3");
    expect(data.supportsDirectUpload).toBe(true);
    expect(data.isConfigured).toBe(true);
  });

  it("returns error when s3 missing config", async () => {
    process.env.FILE_STORAGE_TYPE = "s3";
    const { GET } = await importRoute();
    const response = await GET();
    const data = await response.json();
    
    expect(data.isConfigured).toBe(false);
    expect(data.error).toMatch(/Missing S3 configuration/);
  });

  it("s3 valid with AWS_REGION as fallback", async () => {
    process.env.FILE_STORAGE_TYPE = "s3";
    process.env.FILE_STORAGE_S3_BUCKET = "bucket";
    process.env.AWS_REGION = "us-west-2";
    const { GET } = await importRoute();
    const response = await GET();
    const data = await response.json();
    
    expect(data.isConfigured).toBe(true);
  });
});

describe("checkStorageConfiguration", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.FILE_STORAGE_TYPE;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.FILE_STORAGE_S3_BUCKET;
    delete process.env.FILE_STORAGE_S3_REGION;
    delete process.env.AWS_REGION;
  });

  it("invalid when vercel-blob missing token", async () => {
    process.env.FILE_STORAGE_TYPE = "vercel-blob";
    const { checkStorageConfiguration } = await importRoute();
    const res = checkStorageConfiguration();
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/BLOB_READ_WRITE_TOKEN/);
  });

  it("vercel-blob valid with token", async () => {
    process.env.FILE_STORAGE_TYPE = "vercel-blob";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    const { checkStorageConfiguration } = await importRoute();
    const res = checkStorageConfiguration();
    expect(res.isValid).toBe(true);
  });

  it("s3 missing config", async () => {
    process.env.FILE_STORAGE_TYPE = "s3";
    const { checkStorageConfiguration } = await importRoute();
    const res = checkStorageConfiguration();
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Missing S3 configuration/);
  });

  it("s3 valid with required envs", async () => {
    process.env.FILE_STORAGE_TYPE = "s3";
    process.env.FILE_STORAGE_S3_BUCKET = "bucket";
    process.env.FILE_STORAGE_S3_REGION = "us-east-1";
    const { checkStorageConfiguration } = await importRoute();
    const res = checkStorageConfiguration();
    expect(res.isValid).toBe(true);
  });
});
