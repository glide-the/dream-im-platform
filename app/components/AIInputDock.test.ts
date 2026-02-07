import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AIInputDock from "./AIInputDock";
import {
  runWithFileDialogTaskLock,
  shouldHandleOpenFileDialogSignal,
} from "./AIInputDock";

describe("shouldHandleOpenFileDialogSignal", () => {
  it("returns false for empty or repeated signals", () => {
    expect(shouldHandleOpenFileDialogSignal(undefined, 0)).toBe(false);
    expect(shouldHandleOpenFileDialogSignal(0, 0)).toBe(false);
    expect(shouldHandleOpenFileDialogSignal(3, 3)).toBe(false);
  });

  it("returns true for a new positive signal", () => {
    expect(shouldHandleOpenFileDialogSignal(1, 0)).toBe(true);
    expect(shouldHandleOpenFileDialogSignal(4, 3)).toBe(true);
  });
});

describe("runWithFileDialogTaskLock", () => {
  it("runs only once in the same task, then unlocks in next microtask", async () => {
    const callback = vi.fn();

    expect(runWithFileDialogTaskLock(callback)).toBe(true);
    expect(runWithFileDialogTaskLock(callback)).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1);

    await Promise.resolve();

    expect(runWithFileDialogTaskLock(callback)).toBe(true);
    expect(callback).toHaveBeenCalledTimes(2);

    await Promise.resolve();
  });
});

describe("AIInputDock mode rendering", () => {
  it("does not render legacy attachment submenu entries in simple mode", () => {
    const html = renderToStaticMarkup(
      createElement(AIInputDock, {
        mode: "simple",
        onSendMessage: () => undefined,
      }),
    );

    expect(html).not.toContain("上传附件");
    expect(html).not.toContain("上传图片");
    expect(html).not.toContain("拍照上传");
    expect(html).toContain("上传方式：粘贴 (Ctrl/Cmd + V) · 拖拽 · 点击选择");
  });
});
