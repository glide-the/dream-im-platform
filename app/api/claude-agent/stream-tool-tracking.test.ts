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
  state?: { currentReasoningId: string | null; hasThinkingDelta: boolean },
): void {
  // Handle thinking_delta events - stream incremental reasoning
  if (event.type === "thinking_delta" && event.output && state) {
    if (!state.currentReasoningId) {
      state.currentReasoningId = `reasoning-${Date.now()}`;
      chunks.push({ type: "reasoning-start", id: state.currentReasoningId });
    }
    state.hasThinkingDelta = true;
    chunks.push({ type: "reasoning-delta", id: state.currentReasoningId, delta: String(event.output) });
    return;
  }

  // Handle complete thinking blocks with dedup against thinking_delta
  if (event.type === "thinking" && event.output && state) {
    if (state.hasThinkingDelta && state.currentReasoningId) {
      chunks.push({ type: "reasoning-end", id: state.currentReasoningId });
      state.currentReasoningId = null;
      state.hasThinkingDelta = false;
      return;
    }
    const reasoningId = `reasoning-${Date.now()}`;
    chunks.push({ type: "reasoning-start", id: reasoningId });
    chunks.push({ type: "reasoning-delta", id: reasoningId, delta: String(event.output) });
    chunks.push({ type: "reasoning-end", id: reasoningId });
    return;
  }

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

  // Forward tool_progress as metadata
  if (event.type === "tool_progress" && event.toolCallId) {
    chunks.push({
      type: "message-metadata",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      elapsedTimeSeconds: (event.output as { elapsedTimeSeconds?: number })?.elapsedTimeSeconds,
    });
  }

  // Forward tool_use_summary as text blocks
  if (event.type === "tool_use_summary" && event.output) {
    const summaryOutput = event.output as { summary: string };
    chunks.push({ type: "text-start", id: "summary" });
    chunks.push({ type: "text-delta", id: "summary", delta: summaryOutput.summary });
    chunks.push({ type: "text-end", id: "summary" });
  }

  // Forward result as metadata
  if (event.type === "result" && event.output) {
    chunks.push({ type: "message-metadata", ...event.output as Record<string, unknown> });
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

      // tool_progress now forwards as message-metadata, but does NOT register the tool
      expect(chunks.some((c) => c.type === "tool-input-start")).toBe(false);
      expect(registered.has("call_prog")).toBe(false);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ type: "message-metadata", toolCallId: "call_prog", elapsedTimeSeconds: 5 });
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

      // tool_use_summary now forwards as text blocks, but does NOT register tools
      expect(chunks.some((c) => c.type === "tool-input-start")).toBe(false);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({ type: "text-start" });
      expect(chunks[1]).toMatchObject({ type: "text-delta", delta: "searched web" });
      expect(chunks[2]).toMatchObject({ type: "text-end" });
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

  describe("thinking_delta / thinking deduplication", () => {
    it("should stream thinking_delta as incremental reasoning chunks", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];
      const state = { currentReasoningId: null as string | null, hasThinkingDelta: false };

      processToolEvent(
        { type: "thinking_delta", output: "Let me think about " },
        "auto",
        registered,
        chunks,
        state,
      );
      processToolEvent(
        { type: "thinking_delta", output: "this problem..." },
        "auto",
        registered,
        chunks,
        state,
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({ type: "reasoning-start" });
      expect(chunks[1]).toMatchObject({ type: "reasoning-delta", delta: "Let me think about " });
      expect(chunks[2]).toMatchObject({ type: "reasoning-delta", delta: "this problem..." });
      expect(state.hasThinkingDelta).toBe(true);
      expect(state.currentReasoningId).not.toBeNull();
    });

    it("should close reasoning stream when thinking block arrives after thinking_delta", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];
      const state = { currentReasoningId: null as string | null, hasThinkingDelta: false };

      // First: thinking_delta events
      processToolEvent(
        { type: "thinking_delta", output: "partial thought" },
        "auto",
        registered,
        chunks,
        state,
      );

      // Then: complete thinking block (should just close, not duplicate)
      processToolEvent(
        { type: "thinking", output: "partial thought complete" },
        "auto",
        registered,
        chunks,
        state,
      );

      // Should have: reasoning-start, reasoning-delta, reasoning-end (no duplicate content)
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({ type: "reasoning-start" });
      expect(chunks[1]).toMatchObject({ type: "reasoning-delta", delta: "partial thought" });
      expect(chunks[2]).toMatchObject({ type: "reasoning-end" });
      expect(state.hasThinkingDelta).toBe(false);
      expect(state.currentReasoningId).toBeNull();
    });

    it("should emit full thinking block when no thinking_delta preceded it", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];
      const state = { currentReasoningId: null as string | null, hasThinkingDelta: false };

      processToolEvent(
        { type: "thinking", output: "full thought" },
        "auto",
        registered,
        chunks,
        state,
      );

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toMatchObject({ type: "reasoning-start" });
      expect(chunks[1]).toMatchObject({ type: "reasoning-delta", delta: "full thought" });
      expect(chunks[2]).toMatchObject({ type: "reasoning-end" });
    });
  });

  describe("result event forwarding", () => {
    it("should forward result events as metadata", () => {
      const registered = new Set<string>();
      const chunks: StreamChunk[] = [];

      processToolEvent(
        {
          type: "result",
          output: {
            subtype: "success",
            durationMs: 23400,
            numTurns: 5,
            totalCostUsd: 0.032,
            usage: { input_tokens: 12345, output_tokens: 2678 },
          },
        },
        "auto",
        registered,
        chunks,
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "message-metadata",
        subtype: "success",
        durationMs: 23400,
        numTurns: 5,
        totalCostUsd: 0.032,
      });
    });
  });
});
