/**
 * Tests for getToolStatus logic fix.
 *
 * Validates that:
 * 1. Tools with output-available/output-error states are always "completed"/"error"
 * 2. Tools without completion state show "executing" when isLoading is true
 * 3. Tools without completion state show "completed" when isLoading is false (historical messages)
 * 4. The isLast parameter does NOT affect status determination
 */
import { describe, it, expect } from "vitest";

type ToolStatus = "executing" | "completed" | "error";

const TOOL_COMPLETED_STATES = new Set(["output-available", "output-error"]);

/**
 * Extracted and fixed getToolStatus logic from ChatMessageList.tsx.
 * The fix removes the isLast dependency that caused incorrect status for
 * non-last messages with in-progress tools.
 */
function getToolStatus(
  partState: string | undefined,
  isLoading: boolean,
  _isLast: boolean,
): ToolStatus {
  if (partState === "output-error") return "error";
  if (TOOL_COMPLETED_STATES.has(partState ?? "")) return "completed";
  // No explicit completion state and still loading → executing
  if (isLoading) return "executing";
  // Neither completed nor loading → historical message, treat as completed
  return "completed";
}

describe("getToolStatus", () => {
  describe("completed states", () => {
    it("should return 'completed' for output-available state regardless of isLoading/isLast", () => {
      expect(getToolStatus("output-available", true, true)).toBe("completed");
      expect(getToolStatus("output-available", true, false)).toBe("completed");
      expect(getToolStatus("output-available", false, true)).toBe("completed");
      expect(getToolStatus("output-available", false, false)).toBe("completed");
    });

    it("should return 'error' for output-error state regardless of isLoading/isLast", () => {
      expect(getToolStatus("output-error", true, true)).toBe("error");
      expect(getToolStatus("output-error", true, false)).toBe("error");
      expect(getToolStatus("output-error", false, true)).toBe("error");
      expect(getToolStatus("output-error", false, false)).toBe("error");
    });
  });

  describe("executing state (fix for P2)", () => {
    it("should return 'executing' when loading, even for non-last messages", () => {
      // This was the bug: non-last message tools showed as "executing" unconditionally
      expect(getToolStatus("input-available", true, false)).toBe("executing");
      expect(getToolStatus("input-available", true, true)).toBe("executing");
      expect(getToolStatus(undefined, true, false)).toBe("executing");
      expect(getToolStatus(undefined, true, true)).toBe("executing");
    });

    it("should return 'completed' for historical messages (not loading)", () => {
      // Historical messages without completion state should show as completed
      expect(getToolStatus("input-available", false, false)).toBe("completed");
      expect(getToolStatus("input-available", false, true)).toBe("completed");
      expect(getToolStatus(undefined, false, false)).toBe("completed");
      expect(getToolStatus(undefined, false, true)).toBe("completed");
    });
  });

  describe("isLast independence", () => {
    it("should produce same result regardless of isLast parameter", () => {
      const states = ["output-available", "output-error", "input-available", undefined];
      const loadingValues = [true, false];

      for (const state of states) {
        for (const loading of loadingValues) {
          const resultLast = getToolStatus(state, loading, true);
          const resultNotLast = getToolStatus(state, loading, false);
          expect(resultLast).toBe(resultNotLast);
        }
      }
    });
  });
});
