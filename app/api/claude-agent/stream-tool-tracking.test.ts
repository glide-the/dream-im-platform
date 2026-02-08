/**
 * Tests for tool call registration tracking in the Claude Agent API stream.
 *
 * Validates that:
 * 1. tool-input-start is always sent before tool-output-available (prevents AI_UIMessageStreamError)
 * 2. Duplicate tool-input-start is avoided for already-registered tool calls
 * 3. Unregistered toolCallIds are auto-registered before sending tool-output-available
 * 4. Non-start events (tool_progress, tool_input_delta) don't trigger tool-input-start
 */
import { describe, it, expect } from "vitest";

/**
 * Extracted logic from route.ts onToolEvent handler.
 * This simulates the tool event processing and stream chunk emission.
 */
interface ToolEventPayload {
  type: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
  title?: string;
  providerExecuted?: boolean;
}

interface StreamChunk {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

function processToolEvent(
  event: ToolEventPayload,
  toolChoice: "auto" | "manual" | "none",
  registeredToolCallIds: Set<string>,
  chunks: StreamChunk[],
): void {
  const isToolStartEvent = event.type === "tool_use" || event.type === "tool_use_start";

  if (isToolStartEvent && event.toolCallId && event.toolName) {
    if (toolChoice === "manual") {
      return;
    }

    if (!registeredToolCallIds.has(event.toolCallId)) {
      registeredToolCallIds.add(event.toolCallId);
      chunks.push({
        type: "tool-input-start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
    }

    if (event.input !== undefined) {
      chunks.push({
        type: "tool-input-available",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      });
    }
  }

  if (event.type === "tool_result" && event.toolCallId) {
    if (!registeredToolCallIds.has(event.toolCallId)) {
      const fallbackToolName = event.toolName ?? "unknown";
      registeredToolCallIds.add(event.toolCallId);
      chunks.push({
        type: "tool-input-start",
        toolCallId: event.toolCallId,
        toolName: fallbackToolName,
      });
      chunks.push({
        type: "tool-input-available",
        toolCallId: event.toolCallId,
        toolName: fallbackToolName,
        input: {},
      });
    }

    chunks.push({
      type: "tool-output-available",
      toolCallId: event.toolCallId,
      output: event.output,
    });
  }
}

describe("stream tool call registration tracking", () => {
  describe("happy path: tool_use_start → tool_result", () => {
    it("should send tool-input-start before tool-output-available", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_use_start", toolCallId: "call_abc", toolName: "WebSearch", input: { query: "test" } },
        "auto",
        registered,
        chunks,
      );
      processToolEvent(
        { type: "tool_result", toolCallId: "call_abc", output: { result: "found" } },
        "auto",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({ type: "tool-input-start", toolCallId: "call_abc", toolName: "WebSearch" });
      expect(chunks[1]).toMatchObject({ type: "tool-input-available", toolCallId: "call_abc" });
      expect(chunks[2]).toMatchObject({ type: "tool-output-available", toolCallId: "call_abc" });
    });
  });

  describe("failure path: tool_result arrives for unknown toolCallId", () => {
    it("should auto-register with tool-input-start before tool-output-available", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      // Simulate tool_result arriving WITHOUT a prior tool_use_start
      processToolEvent(
        { type: "tool_result", toolCallId: "call_unknown_123", output: "some result" },
        "auto",
        registered,
        chunks,
      );

      // Should have auto-registered: input-start + input-available + output-available
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({
        type: "tool-input-start",
        toolCallId: "call_unknown_123",
        toolName: "unknown",
      });
      expect(chunks[1]).toMatchObject({
        type: "tool-input-available",
        toolCallId: "call_unknown_123",
        toolName: "unknown",
        input: {},
      });
      expect(chunks[2]).toMatchObject({
        type: "tool-output-available",
        toolCallId: "call_unknown_123",
      });
      expect(registered.has("call_unknown_123")).toBe(true);
    });

    it("should use toolName from event if available for unregistered tool result", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_result", toolCallId: "call_xyz", toolName: "Bash", output: "done" },
        "auto",
        registered,
        chunks,
      );

      expect(chunks[0]).toMatchObject({
        type: "tool-input-start",
        toolCallId: "call_xyz",
        toolName: "Bash",
      });
    });
  });

  describe("deduplication: duplicate tool_use events", () => {
    it("should not send duplicate tool-input-start for same toolCallId", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      // First event from stream_event content_block_start
      processToolEvent(
        { type: "tool_use_start", toolCallId: "call_dup", toolName: "WebFetch", input: { url: "https://example.com" } },
        "auto",
        registered,
        chunks,
      );

      // Second event from assistant message (includePartialMessages duplicate)
      processToolEvent(
        { type: "tool_use", toolCallId: "call_dup", toolName: "WebFetch", input: { url: "https://example.com" } },
        "auto",
        registered,
        chunks,
      );

      // Should only have ONE tool-input-start but TWO tool-input-available
      const inputStarts = chunks.filter((c) => c.type === "tool-input-start");
      expect(inputStarts).toHaveLength(1);

      const inputAvailables = chunks.filter((c) => c.type === "tool-input-available");
      expect(inputAvailables).toHaveLength(2);
    });
  });

  describe("non-start events should not register tools", () => {
    it("should not send tool-input-start for tool_progress events", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_progress", toolCallId: "call_prog", toolName: "Bash", output: { elapsedTimeSeconds: 5 } },
        "auto",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(0);
      expect(registered.has("call_prog")).toBe(false);
    });

    it("should not send tool-input-start for tool_input_delta events", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_input_delta", output: '{"query":' },
        "auto",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(0);
    });

    it("should not send tool-input-start for tool_use_summary events", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_use_summary", output: { summary: "searched web" } },
        "auto",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(0);
    });
  });

  describe("manual mode", () => {
    it("should skip tool_use events in manual mode (handled by onToolConfirmationRequest)", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_use", toolCallId: "call_manual", toolName: "WebSearch", input: { q: "test" } },
        "manual",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(0);
      expect(registered.has("call_manual")).toBe(false);
    });

    it("should skip tool_use_start events in manual mode", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        { type: "tool_use_start", toolCallId: "call_manual2", toolName: "Bash" },
        "manual",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(0);
    });

    it("should still auto-register for tool_result in manual mode if not yet registered", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      // In manual mode, onToolConfirmationRequest registers the tool.
      // But if somehow a tool_result arrives without prior registration:
      processToolEvent(
        { type: "tool_result", toolCallId: "call_manual_result", output: "ok" },
        "manual",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe("tool-input-start");
      expect(chunks[2].type).toBe("tool-output-available");
    });
  });

  describe("multi-tool chain", () => {
    it("should handle multiple tools in sequence correctly", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      // Tool A
      processToolEvent(
        { type: "tool_use_start", toolCallId: "call_A", toolName: "WebSearch", input: { q: "github" } },
        "auto",
        registered,
        chunks,
      );
      processToolEvent(
        { type: "tool_result", toolCallId: "call_A", output: { url: "https://github.com" } },
        "auto",
        registered,
        chunks,
      );

      // Tool B
      processToolEvent(
        { type: "tool_use_start", toolCallId: "call_B", toolName: "WebFetch", input: { url: "https://github.com" } },
        "auto",
        registered,
        chunks,
      );
      processToolEvent(
        { type: "tool_result", toolCallId: "call_B", output: { content: "page content" } },
        "auto",
        registered,
        chunks,
      );

      expect(registered.size).toBe(2);
      expect(registered.has("call_A")).toBe(true);
      expect(registered.has("call_B")).toBe(true);

      // Verify ordering: each tool's input-start comes before its output-available
      const aStart = chunks.findIndex((c) => c.type === "tool-input-start" && c.toolCallId === "call_A");
      const aOutput = chunks.findIndex((c) => c.type === "tool-output-available" && c.toolCallId === "call_A");
      const bStart = chunks.findIndex((c) => c.type === "tool-input-start" && c.toolCallId === "call_B");
      const bOutput = chunks.findIndex((c) => c.type === "tool-output-available" && c.toolCallId === "call_B");

      expect(aStart).toBeLessThan(aOutput);
      expect(bStart).toBeLessThan(bOutput);
    });
  });
});
