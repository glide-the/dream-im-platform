import { describe, expect, it } from "vitest";
import { collectUploadItemsFromDrop } from "./workspace-upload";

interface MockFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

interface MockDirectoryEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => {
    readEntries: (
      successCallback: (entries: Array<MockDirectoryEntry | MockFileEntry>) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  };
}

function createMockFileEntry(file: File): MockFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (successCallback) => {
      successCallback(file);
    },
  };
}

function createMockFailingFileEntry(
  name: string,
  message: string,
): MockFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (_successCallback, errorCallback) => {
      errorCallback?.(new DOMException(message, "NotFoundError"));
    },
  };
}

function createMockDirectoryEntry(
  name: string,
  children: Array<MockDirectoryEntry | MockFileEntry>,
): MockDirectoryEntry {
  let done = false;

  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (successCallback) => {
        if (done) {
          successCallback([]);
          return;
        }

        done = true;
        successCallback(children);
      },
    }),
  };
}

function createDataTransfer(
  items: DataTransferItem[],
  files: File[] = [],
): Pick<DataTransfer, "items" | "files"> {
  return {
    items: items as unknown as DataTransferItemList,
    files: files as unknown as FileList,
  };
}

function createEntryBackedDropItem(
  entry: MockDirectoryEntry | MockFileEntry,
): DataTransferItem {
  return {
    kind: "file",
    type: "",
    getAsFile: () => null,
    webkitGetAsEntry: () => entry,
  } as unknown as DataTransferItem;
}

describe("collectUploadItemsFromDrop", () => {
  it("recursively collects all files from a dropped folder", async () => {
    const fileA = new File(["a"], "a.txt", { type: "text/plain" });
    const fileB = new File(["b"], "b.txt", { type: "text/plain" });

    const nestedDir = createMockDirectoryEntry("sub", [createMockFileEntry(fileB)]);
    const rootDir = createMockDirectoryEntry("folderA", [
      createMockFileEntry(fileA),
      nestedDir,
    ]);

    const result = await collectUploadItemsFromDrop(
      createDataTransfer([createEntryBackedDropItem(rootDir)]),
      { yieldEvery: 1 },
    );

    expect(result.errors).toEqual([]);
    expect(result.items.map((item) => item.relativePath).sort()).toEqual([
      "folderA/a.txt",
      "folderA/sub/b.txt",
    ]);
  });

  it("returns a helpful error when directory drag API is not supported", async () => {
    const unsupportedItem = {
      kind: "file",
      type: "",
      getAsFile: () => null,
    } as unknown as DataTransferItem;

    const result = await collectUploadItemsFromDrop(
      createDataTransfer([unsupportedItem]),
    );

    expect(result.items).toHaveLength(0);
    expect(result.errors.join(" ")).toContain("不支持拖拽文件夹解析");
  });

  it("returns a helpful error when dropped folder is empty", async () => {
    const emptyRootDir = createMockDirectoryEntry("empty-folder", []);

    const result = await collectUploadItemsFromDrop(
      createDataTransfer([createEntryBackedDropItem(emptyRootDir)]),
    );

    expect(result.items).toHaveLength(0);
    expect(result.errors.join(" ")).toContain("拖拽目录为空");
  });

  it("falls back to dataTransfer.files when entry traversal fails", async () => {
    const fallbackFile = new File(["fallback"], "fallback.txt", {
      type: "text/plain",
    });
    const brokenRootDir = createMockDirectoryEntry("html_design_skill", [
      createMockFailingFileEntry(
        "missing.txt",
        "A requested file or directory could not be found at the time an operation was processed.",
      ),
    ]);

    const result = await collectUploadItemsFromDrop(
      createDataTransfer(
        [createEntryBackedDropItem(brokenRootDir)],
        [fallbackFile],
      ),
      { yieldEvery: 1 },
    );

    expect(result.items.map((item) => item.relativePath)).toContain("fallback.txt");
    expect(result.errors.join(" ")).toContain("A requested file or directory could not be found");
    expect(result.errors.join(" ")).not.toContain("拖拽目录为空");
  });
});
