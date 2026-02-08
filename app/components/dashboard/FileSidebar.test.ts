import { describe, expect, it } from "vitest";
import {
  buildWorkspaceFileDownloadUrl,
  extractFilenameFromContentDisposition,
  getWorkspaceFileDownloadErrorMessage,
} from "./FileSidebar";

describe("FileSidebar download helpers", () => {
  it("builds encoded download URL for nested workspace path", () => {
    expect(buildWorkspaceFileDownloadUrl("session-1", "files/reports/周报 01.txt")).toBe(
      "/api/workspace/files/download?sessionId=session-1&path=files%2Freports%2F%E5%91%A8%E6%8A%A5+01.txt",
    );
  });

  it("extracts filename from content-disposition headers", () => {
    expect(
      extractFilenameFromContentDisposition(
        "attachment; filename=\"report.txt\"; filename*=UTF-8''report.txt",
      ),
    ).toBe("report.txt");

    expect(
      extractFilenameFromContentDisposition(
        "attachment; filename*=UTF-8''%E5%91%A8%E6%8A%A5.txt",
      ),
    ).toBe("周报.txt");
  });

  it("returns understandable fallback messages for download failures", () => {
    expect(getWorkspaceFileDownloadErrorMessage(404)).toBe("文件不存在或已被删除。");
    expect(getWorkspaceFileDownloadErrorMessage(403)).toBe(
      "没有权限下载该文件，请检查会话或权限配置。",
    );
    expect(getWorkspaceFileDownloadErrorMessage(500, "Network down")).toBe(
      "Network down",
    );
  });
});
