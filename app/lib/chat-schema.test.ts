/**
 * Tests for chat-schema.ts tool confirmation types
 */
import { describe, it, expect } from "vitest";
import {
  ManualToolConfirmTag,
  isToolUIPart,
  isManualToolInvocation,
  type ChatMetadata,
  type ToolUIPart,
} from "./chat-schema";

describe("chat-schema tool confirmation types", () => {
  describe("ManualToolConfirmTag", () => {
    it("should create a confirmation tag", () => {
      const confirm = ManualToolConfirmTag.create({ confirm: true });
      expect(confirm.confirm).toBe(true);
      expect(ManualToolConfirmTag.isMaybe(confirm)).toBe(true);
    });

    it("should create a rejection tag", () => {
      const reject = ManualToolConfirmTag.create({ confirm: false });
      expect(reject.confirm).toBe(false);
      expect(ManualToolConfirmTag.isMaybe(reject)).toBe(true);
    });

    it("should not match non-tagged objects", () => {
      expect(ManualToolConfirmTag.isMaybe({ confirm: true })).toBe(false);
      expect(ManualToolConfirmTag.isMaybe(null)).toBe(false);
      expect(ManualToolConfirmTag.isMaybe(undefined)).toBe(false);
    });
  });

  describe("isToolUIPart", () => {
    it("should return true for tool parts", () => {
      const toolPart = { type: "tool" };
      expect(isToolUIPart(toolPart)).toBe(true);
    });

    it("should return false for non-tool parts", () => {
      expect(isToolUIPart({ type: "text" })).toBe(false);
      expect(isToolUIPart({ type: "reasoning" })).toBe(false);
    });
  });

  describe("isManualToolInvocation", () => {
    const baseToolPart: ToolUIPart = {
      type: "tool",
      toolCallId: "tc_123",
      toolName: "test_tool",
      input: { query: "test" },
      state: "input-available",
    };

    const manualMetadata: ChatMetadata = {
      toolChoice: "manual",
    };

    const autoMetadata: ChatMetadata = {
      toolChoice: "auto",
    };

    it("should return true for manual tool invocation in correct state", () => {
      expect(isManualToolInvocation(baseToolPart, manualMetadata, true, true)).toBe(true);
    });

    it("should return false when toolChoice is not manual", () => {
      expect(isManualToolInvocation(baseToolPart, autoMetadata, true, true)).toBe(false);
      expect(isManualToolInvocation(baseToolPart, undefined, true, true)).toBe(false);
    });

    it("should return false when not last message", () => {
      expect(isManualToolInvocation(baseToolPart, manualMetadata, false, true)).toBe(false);
    });

    it("should return false when not loading", () => {
      expect(isManualToolInvocation(baseToolPart, manualMetadata, true, false)).toBe(false);
    });

    it("should return false when state is not input-available", () => {
      const outputPart: ToolUIPart = { ...baseToolPart, state: "output-available" };
      expect(isManualToolInvocation(outputPart, manualMetadata, true, true)).toBe(false);
      
      const errorPart: ToolUIPart = { ...baseToolPart, state: "error" };
      expect(isManualToolInvocation(errorPart, manualMetadata, true, true)).toBe(false);
    });
  });
});
