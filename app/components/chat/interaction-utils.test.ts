import { describe, expect, it } from "vitest";
import { getVisibleOperations, shouldSendMessageOnKeyDown, shouldShowExpandOperations, type OperationPart } from "./interaction-utils";

const operations: OperationPart[] = [
  { id: "1", type: "step-start", text: "step 1" },
  { id: "2", type: "reasoning", text: "reasoning 1" },
  { id: "3", type: "reasoning", text: "reasoning 2" },
  { id: "4", type: "reasoning", text: "reasoning 3" },
];

describe("interaction-utils", () => {
  it("returns only first three operations when collapsed", () => {
    expect(getVisibleOperations(operations, false)).toHaveLength(3);
    expect(shouldShowExpandOperations(operations)).toBe(true);
  });

  it("returns all operations when expanded", () => {
    expect(getVisibleOperations(operations, true)).toHaveLength(4);
  });

  it("sends only on meta + enter", () => {
    expect(shouldSendMessageOnKeyDown({ key: "Enter", metaKey: true, shiftKey: false })).toBe(true);
  });

  it("does not send on plain enter", () => {
    expect(shouldSendMessageOnKeyDown({ key: "Enter", metaKey: false, shiftKey: false })).toBe(false);
  });
});
