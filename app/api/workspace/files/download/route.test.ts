import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetOrCreateWorkspace = vi.fn();
const mockReadWorkspaceFileContent = vi.fn();

class MockWorkspaceFileAccessError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "WorkspaceFileAccessError";
    this.code = code;
    this.status = status;
  }
}

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspace: mockGetOrCreateWorkspace,
  readWorkspaceFileContent: mockReadWorkspaceFileContent,
  WorkspaceFileAccessError: MockWorkspaceFileAccessError,
}));

const importRoute = async () => import("./route");

describe("GET /api/workspace/files/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads a workspace file", async () => {
    mockGetOrCreateWorkspace.mockReturnValue("/tmp/workspace/session-1");
    mockReadWorkspaceFileContent.mockReturnValue({
      content: Buffer.from("hello workspace", "utf8"),
      fileName: "report.txt",
      size: 15,
      modifiedAt: new Date("2026-02-08T00:00:00.000Z").toISOString(),
    });

    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest(
        "http://localhost/api/workspace/files/download?sessionId=session-1&path=files/report.txt",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Content-Disposition")).toContain("report.txt");

    const body = Buffer.from(await response.arrayBuffer()).toString("utf8");
    expect(body).toBe("hello workspace");
    expect(mockGetOrCreateWorkspace).toHaveBeenCalledWith("session-1");
    expect(mockReadWorkspaceFileContent).toHaveBeenCalledWith(
      "/tmp/workspace/session-1",
      "files/report.txt",
    );
  });

  it("returns 400 when query is invalid", async () => {
    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest("http://localhost/api/workspace/files/download?sessionId=session-1"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "sessionId and path are required",
    });
    expect(mockGetOrCreateWorkspace).not.toHaveBeenCalled();
  });

  it("returns directory-not-supported message from workspace errors", async () => {
    mockGetOrCreateWorkspace.mockReturnValue("/tmp/workspace/session-1");
    mockReadWorkspaceFileContent.mockImplementation(() => {
      throw new MockWorkspaceFileAccessError(
        "IS_DIRECTORY",
        "Directory download is not supported",
        400,
      );
    });

    const { GET } = await importRoute();
    const response = await GET(
      new NextRequest(
        "http://localhost/api/workspace/files/download?sessionId=session-1&path=files",
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Directory download is not supported",
      code: "IS_DIRECTORY",
    });
  });
});
