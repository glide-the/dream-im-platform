import { describe, expect, it, vi } from "vitest";
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
