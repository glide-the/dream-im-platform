// app/api/claude-agent/route.ts
// Reference: cgoinglove/better-chatbot src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  createUIMessageStream,
  UIMessage,
  isToolUIPart,
} from "ai";
import {
  chatApiSchemaRequestBodySchema,
  type ChatApiSchemaRequestBody,
  type ChatAttachment,
  type ChatMetadata,
  type WorkspaceFilePathPart,
  DEFAULT_CHAT_MODEL,
  ManualToolConfirmTag,
  MANUAL_REJECT_RESPONSE_PROMPT,
} from "../../lib/chat-schema";
import {
  createAgentRunner,
  SimpleClaudeAgentSDKClient,
  type AgentStreamingCallbacks,
  type ToolChoiceMode,
} from "../../lib/claude-agent-kit/server";
import {
  createConversation,
  updateConversation,
  getConversationById,
} from "../../lib/db";
import { createId } from "../../lib/id";
import type { Conversation, MessagePart, Attachment, ToolType } from "../../lib/types";
import { createPendingToolConfirmation } from "../../lib/tool-confirmation-store";
import {
  injectAttachmentMessageParts,
  processChatAttachmentsForMessage,
} from "../../lib/chat-attachment-processing";
import { getOrCreateWorkspace } from "../../lib/workspace";
import { extractTextFromParts } from "../../lib/message-parts";

export const runtime = "nodejs";

const DEFAULT_MAX_TURNS = Number(process.env.MAX_TURNS) || 10;
const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 15000;
const SSE_HEARTBEAT_CHUNK_TYPE = "data-sse-heartbeat";
const SSE_HEARTBEAT_MODE_EVENT = "event";
type UIMessagePart = NonNullable<UIMessage["parts"]>[number];
type PersistableUIMessagePart = UIMessagePart | WorkspaceFilePathPart;
type HeartbeatFrameMode = "comment" | "event";
type HeartbeatChunk = {
  type: typeof SSE_HEARTBEAT_CHUNK_TYPE;
  data: { frame: string };
  transient: true;
};

// Check if a part type is a tool type (starts with "tool-" or is "dynamic-tool")
function isToolPartType(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

/**
 * Convert UIMessage parts to our storage format.
 * Following the better-chatbot convertToSavePart pattern, we save ALL parts 
 * from the chat stream preserving their original type as streamed.
 * 
 * IMPORTANT: We preserve the original `type` field exactly as streamed
 * (e.g., "text", "reasoning", "tool-search", "dynamic-tool", "step-start")
 * to allow faithful restoration when loading from database.
 * 
 * Reference: cgoinglove/better-chatbot src/app/api/chat/shared.chat.ts - convertToSavePart
 */
function convertToStorageParts(
  parts: ReadonlyArray<PersistableUIMessagePart> | undefined
): MessagePart[] {
  if (!parts || !Array.isArray(parts)) return [];

  return parts.map((part) => {
    // Handle text parts - preserve as-is with state
    if (part.type === "text") {
      const textPart = part as { type: "text"; text: string };
      return {
        type: "text" as const,
        text: textPart.text,
        state: "done" as const,
      };
    }

    // Handle reasoning parts - preserve type exactly as streamed
    if (part.type === "reasoning") {
      return {
        type: "reasoning" as const,
        text: (part as { type: "reasoning"; text: string }).text,
        state: "done" as const,
      };
    }

    // Handle step-start parts - preserve type exactly
    if (part.type === "step-start") {
      return {
        type: "step-start" as const,
      };
    }

    // Handle tool parts (tool-*, dynamic-tool, tool)
    // PRESERVE the original type field EXACTLY as streamed
    if (isToolPartType(part.type) || isToolUIPart(part)) {
      const toolPart = part as {
        type: string;
        toolCallId: string;
        toolName?: string;
        input: Record<string, unknown>;
        output?: unknown;
        state?: string;
        title?: string;
        providerExecuted?: boolean;
      };

      // Extract tool name from toolName property or from type (e.g., "tool-search" -> "search")
      let resolvedToolName = toolPart.toolName;
      if (!resolvedToolName && part.type.startsWith("tool-")) {
        resolvedToolName = part.type.slice(5); // Remove "tool-" prefix
      }
      if (!resolvedToolName) {
        resolvedToolName = "unknown";
      }

      // PRESERVE original type EXACTLY: "tool-search", "dynamic-tool", "tool", etc.
      return {
        type: part.type as ToolType,
        toolCallId: toolPart.toolCallId,
        toolName: resolvedToolName,
        input: toolPart.input ?? {},
        output: toolPart.output,
        state: (toolPart.state ?? "done") as "input-available" | "input-streaming" | "output-available" | "output-error" | "error" | "done",
        // Extended parameters - preserved from stream
        title: toolPart.title,
        providerExecuted: toolPart.providerExecuted,
      };
    }

    // Handle file parts - preserve type exactly
    if (part.type === "file") {
      const filePart = part as {
        type: "file";
        url: string;
        mediaType?: string;
        filename?: string;
      };
      return {
        type: "file" as const,
        url: filePart.url,
        mediaType: filePart.mediaType,
        filename: filePart.filename,
      };
    }

    // Handle source-url parts - preserve type exactly
    if (part.type === "source-url") {
      const sourceUrlPart = part as {
        type: "source-url";
        url: string;
        mediaType?: string;
        title?: string;
      };
      return {
        type: "source-url" as const,
        url: sourceUrlPart.url,
        mediaType: sourceUrlPart.mediaType,
        title: sourceUrlPart.title,
      };
    }

    // Handle workspace-file parts - preserve type exactly
    if (part.type === "workspace-file") {
      const workspaceFilePart = part as {
        type: "workspace-file";
        fileName: string;
        mimeType: string;
        size: number;
        workspacePath: string;
        savedAt: string;
        hash?: string;
      };
      return {
        type: "workspace-file" as const,
        fileName: workspaceFilePart.fileName,
        mimeType: workspaceFilePart.mimeType,
        size: workspaceFilePart.size,
        workspacePath: workspaceFilePart.workspacePath,
        savedAt: workspaceFilePart.savedAt,
        hash: workspaceFilePart.hash,
      };
    }

    // For any other unknown types, preserve them EXACTLY as-is
    // Exclude internal metadata fields that shouldn't be persisted
    // This ensures we don't lose any new part types added in the future
    const { providerMetadata, callProviderMetadata, ...cleanPart } = part as Record<string, unknown>;
    return cleanPart as MessagePart;
  });
}

/** 把 ChatAttachment 映射成 DB Attachment（ai4sales 的 types.ts） */
function mapChatAttachmentToDbAttachment(att: ChatAttachment): Attachment {
  return {
    id: createId("att"),
    name: att.filename ?? att.url,
    type: att.mediaType ?? "application/octet-stream",
    size: att.size ?? 0,
  };
}

function errorResponse(
  status: number,
  payload: {
    error: string;
    code?: string;
    details?: unknown;
  }
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(message: string, code?: string, details?: unknown) {
  return errorResponse(400, {
    error: message,
    code,
    details,
  });
}

function internalServerError(message: string, code?: string, details?: unknown) {
  return errorResponse(500, {
    error: message,
    code,
    details,
  });
}

function resolveHeartbeatIntervalMs(): number {
  const configured = Number(process.env.SSE_HEARTBEAT_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_SSE_HEARTBEAT_INTERVAL_MS;
  }
  return configured;
}

function resolveHeartbeatFrameMode(): HeartbeatFrameMode {
  return process.env.SSE_HEARTBEAT_MODE === SSE_HEARTBEAT_MODE_EVENT
    ? "event"
    : "comment";
}

function isHeartbeatChunk(part: unknown): part is HeartbeatChunk {
  if (!part || typeof part !== "object") {
    return false;
  }
  const candidate = part as {
    type?: unknown;
    data?: { frame?: unknown };
    transient?: unknown;
  };
  return (
    candidate.type === SSE_HEARTBEAT_CHUNK_TYPE &&
    typeof candidate.data?.frame === "string" &&
    candidate.transient === true
  );
}

function createClaudeAgentSSEStreamResponse({
  stream,
  headers,
}: {
  stream: ReadableStream<unknown>;
  headers?: HeadersInit;
}) {
  const sseStream = stream.pipeThrough(
    new TransformStream<unknown, string>({
      transform(part, controller) {
        if (isHeartbeatChunk(part)) {
          controller.enqueue(
            part.data.frame.endsWith("\n\n")
              ? part.data.frame
              : `${part.data.frame}\n\n`
          );
          return;
        }
        controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
      },
      flush(controller) {
        controller.enqueue("data: [DONE]\n\n");
      },
    })
  );

  const responseHeaders = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Vercel-AI-UI-Message-Stream": "v1",
    "X-Accel-Buffering": "no",
  });

  const extraHeaders = new Headers(headers);
  extraHeaders.forEach((value, key) => {
    responseHeaders.set(key, value);
  });

  return new Response(sseStream.pipeThrough(new TextEncoderStream()), {
    headers: responseHeaders,
  });
}

export async function POST(req: NextRequest) {
  // Parse and validate request body using Zod
  let body: ChatApiSchemaRequestBody;

  try {
    const json = await req.json();
    const parsed = chatApiSchemaRequestBodySchema.safeParse(json);

    if (!parsed.success) {
      console.error("[Claude Agent API] Validation error:", parsed.error);
      return badRequest(`Invalid chat body: ${parsed.error.message}`);
    }

    body = parsed.data;
  } catch {
    return badRequest("Invalid request body");
  }

  const {
    id: conversationId,
    message: uiMessage,
    resume = true,
    toolChoice = "auto",
    chatModel,
    attachments = [],
    contextCustomerIds = [],
    systemPrompt,
  } = body;

  let workspaceCwd: string;
  try {
    workspaceCwd = getOrCreateWorkspace(conversationId);
  } catch (error) {
    console.error("[Claude Agent API] Failed to initialize workspace:", error);
    return internalServerError("Failed to initialize workspace");
  }

  const attachmentProcessingResult = await processChatAttachmentsForMessage({
    attachments,
    workspacePath: workspaceCwd,
    downloadFile: async (url: string, storageKey?: string) => {
      if (!storageKey) {
        throw new Error(`Attachment storage key is required for file download: ${url}`);
      }

      const { serverFileStorage } = await import("@/lib/file-storage");
      const buffer = await serverFileStorage.download(storageKey);
      const metadata = await serverFileStorage.getMetadata(storageKey);

      return new Blob([buffer], {
        type: metadata?.contentType || "application/octet-stream",
      });
    },
  });

  if (attachmentProcessingResult.workspaceSyncError) {
    console.warn(
      "[Claude Agent API] Workspace file sync degraded; continuing with WeKnora context:",
      attachmentProcessingResult.workspaceSyncError
    );
  }

  if (attachmentProcessingResult.messageParts.length > 0) {
    uiMessage.parts = injectAttachmentMessageParts(
      uiMessage.parts,
      attachmentProcessingResult.messageParts
    );
    console.log(
      `[Claude Agent API] Injected ${attachmentProcessingResult.ingestionPreviewParts.length} document previews and ${attachmentProcessingResult.workspaceFilePathParts.length} workspace file parts into message`
    );
  }

  // Extract text content from UIMessage
  const messageText = extractTextFromParts(uiMessage.parts);
  if (!messageText.trim()) {
    return badRequest("Empty message content");
  }

  const now = new Date().toISOString();

  // Check if conversation exists
  const existingConversation = await getConversationById(conversationId);

  // Map attachments to DB format
  const dbAttachments = attachments.map(mapChatAttachmentToDbAttachment);

  // Variable to store the session ID from the agent run
  let capturedSessionId: string | null = null;

  // Track tool calls for metadata
  let toolCallCount = 0;

  // Coordinate thinking / thinking_delta deduplication.
  // When thinking_delta arrives first, we open a reasoning stream and set this ID.
  // When the full thinking block arrives later, we skip duplicate output.
  let currentReasoningId: string | null = null;
  let hasThinkingDelta = false;

  // Track toolCallIds that have been registered with tool-input-start in the AI SDK stream.
  // The AI SDK's processUIMessageStream throws AI_UIMessageStreamError when
  // tool-output-available arrives for a toolCallId without a prior tool-input-start.
  const registeredToolCallIds = new Set<string>();

  // Track ALL streamed parts EXACTLY as they are written to the stream
  // This preserves the exact order and format of stream events
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamedParts: any[] = [];

  // Create streaming response using ai SDK (following better-chatbot pattern)
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Create Claude Agent Runner
      const sdkClient = new SimpleClaudeAgentSDKClient();
      const agentRunner = createAgentRunner(sdkClient);

      // Create AbortController and wire it to the client disconnect signal
      const abortController = new AbortController();
      type StreamWritePart = Parameters<typeof writer.write>[0];
      const heartbeatIntervalMs = resolveHeartbeatIntervalMs();
      const heartbeatFrameMode = resolveHeartbeatFrameMode();

      let isClosed = false;
      let isAborted = req.signal.aborted;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const isAbortError = (error: unknown): boolean => {
        return error instanceof Error && error.name === "AbortError";
      };

      const stopHeartbeat = (): void => {
        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const safeWritePart = (part: StreamWritePart): boolean => {
        if (isClosed || isAborted) {
          return false;
        }

        try {
          writer.write(part);
          return true;
        } catch (error) {
          stopHeartbeat();
          if (isAbortError(error) || req.signal.aborted || abortController.signal.aborted) {
            isAborted = true;
            console.info("[Claude Agent API] Stream write aborted by client.");
          } else {
            isClosed = true;
            console.error("[Claude Agent API] Stream write failed:", error);
          }
          return false;
        }
      };

      const safeWriteSSE = (partOrFrame: StreamWritePart | string): boolean => {
        if (typeof partOrFrame === "string") {
          const normalizedFrame = partOrFrame.endsWith("\n\n")
            ? partOrFrame
            : `${partOrFrame}\n\n`;
          const heartbeatChunk: HeartbeatChunk = {
            type: SSE_HEARTBEAT_CHUNK_TYPE,
            data: { frame: normalizedFrame },
            transient: true,
          };
          return safeWritePart(heartbeatChunk as StreamWritePart);
        }
        return safeWritePart(partOrFrame);
      };

      const writeAndTrack = (part: StreamWritePart): boolean => {
        const writeOk = safeWriteSSE(part);
        if (!writeOk) {
          return false;
        }

        // Store exact copy of stream event (excluding 'finish' and 'error' types)
        if (part.type !== "finish" && part.type !== "error") {
          streamedParts.push({ ...part });
        }
        return true;
      };

      const buildHeartbeatFrame = (): string => {
        if (heartbeatFrameMode === "event") {
          return `event: ping\ndata: ${Date.now()}`;
        }
        return `: heartbeat ${Date.now()}`;
      };

      const onRequestAbort = (): void => {
        if (isAborted) {
          return;
        }
        isAborted = true;
        stopHeartbeat();
        abortController.abort();
      };

      req.signal.addEventListener("abort", onRequestAbort, { once: true });

      let fullText = "";
      const assistantMessageId = uiMessage.id
        ? `${uiMessage.id}-response`
        : createId("msg");
      let hasStarted = false;

      heartbeatTimer = setInterval(() => {
        if (!safeWriteSSE(buildHeartbeatFrame())) {
          stopHeartbeat();
        }
      }, heartbeatIntervalMs);

      // Send message-metadata at the START of the stream
      // This allows the frontend to have access to toolChoice BEFORE any tool events arrive
      // This is critical for manual tool confirmation UI - the frontend checks
      // message.metadata?.toolChoice === "manual" to show approve/reject buttons
      // Reference: cgoinglove/better-chatbot passes metadata via toUIMessageStream({ messageMetadata })
      const initialMetadata: ChatMetadata = {
        toolChoice,
        chatModel,
        workspacePath: workspaceCwd,
        workspaceSessionId: conversationId,
      };
      safeWriteSSE({
        type: "message-metadata",
        messageMetadata: initialMetadata,
      });

      // Set up callbacks to stream to UI
      const callbacks: AgentStreamingCallbacks = {
        onTextDelta: async (delta: string) => {
          // Send text-start on first delta
          if (!hasStarted) {
            writeAndTrack({
              type: "text-start",
              id: assistantMessageId,
            });
            hasStarted = true;
          }

          fullText += delta;

          // Write and track text-delta
          writeAndTrack({
            type: "text-delta",
            id: assistantMessageId,
            delta: delta,
          });
        },
        onTextDone: async () => {
          // Send text-end
          if (hasStarted) {
            writeAndTrack({
              type: "text-end",
              id: assistantMessageId,
            });
            hasStarted = false; // Reset for next text block
          }
        },
        onToolEvent: async (event) => {
          // If we have ongoing text, close it first before tool events
          if (hasStarted) {
            writeAndTrack({
              type: "text-end",
              id: assistantMessageId,
            });
            hasStarted = false;
          }

          // Track tool calls
          if (event.type === "tool_use" || event.type === "tool_use_start") {
            toolCallCount++;
          }

          // Handle thinking_delta events - stream incremental reasoning in real-time
          if (event.type === "thinking_delta" && event.output) {
            if (!currentReasoningId) {
              currentReasoningId = createId("reasoning");
              writeAndTrack({ type: "reasoning-start", id: currentReasoningId });
            }
            hasThinkingDelta = true;
            writeAndTrack({
              type: "reasoning-delta",
              id: currentReasoningId,
              delta: String(event.output),
            });
            return;
          }

          // Handle complete thinking blocks - stream as reasoning parts
          // Skip if thinking_delta already streamed this content (dedup)
          if (event.type === "thinking" && event.output) {
            if (hasThinkingDelta && currentReasoningId) {
              // thinking_delta already streamed content; close the stream
              writeAndTrack({ type: "reasoning-end", id: currentReasoningId });
              currentReasoningId = null;
              hasThinkingDelta = false;
              return;
            }
            // No thinking_delta preceded this → emit full block
            const reasoningId = createId("reasoning");
            const reasoningText = String(event.output);
            writeAndTrack({ type: "reasoning-start", id: reasoningId });
            writeAndTrack({ type: "reasoning-delta", id: reasoningId, delta: reasoningText });
            writeAndTrack({ type: "reasoning-end", id: reasoningId });
            return;
          }

          // Stream tool events to frontend using Vercel AI SDK types
          // 
          // IMPORTANT: Two-handler design for manual vs auto mode:
          // - Manual mode (toolChoice === "manual"): onToolConfirmationRequest handles tool_use events
          //   and sends the complete sequence: tool-input-start → tool-input-available → tool-approval-request
          // - Auto mode: onToolEvent handles all tool events and sends tool-input-start → tool-input-available
          //
          // Only send tool-input-start for actual tool start events (tool_use / tool_use_start),
          // NOT for progress, summary, or other non-start events.
          const isToolStartEvent = event.type === "tool_use" || event.type === "tool_use_start";

          if (isToolStartEvent && event.toolCallId && event.toolName) {
            // Manual mode: Skip tool_use events here - they're handled by onToolConfirmationRequest
            // to ensure the correct event sequence for frontend approval UI
            if (toolChoice === "manual") {
              return;
            }

            // Avoid sending duplicate tool-input-start for already-registered tool calls
            // (e.g., when includePartialMessages causes both stream_event and assistant message)
            if (!registeredToolCallIds.has(event.toolCallId)) {
              registeredToolCallIds.add(event.toolCallId);
              writeAndTrack({
                type: "tool-input-start",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                title: event.title,
                providerExecuted: event.providerExecuted,
              });
            }

            // Send tool-input-available with input data
            if (event.input !== undefined) {
              writeAndTrack({
                type: "tool-input-available",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: event.input as Record<string, unknown>,
                title: event.title,
                providerExecuted: event.providerExecuted,
              });
            }
          }

          // Forward tool results with extended parameters
          if (event.type === "tool_result" && event.toolCallId) {
            // Defensive: ensure tool-input-start was sent before tool-output-available.
            // The AI SDK throws AI_UIMessageStreamError if tool-output-available arrives
            // for a toolCallId without a prior tool-input-start registration.
            // This can happen when tool results arrive from sub-agents, multi-turn
            // tool chains, or when tool_use events are skipped/missed.
            if (!registeredToolCallIds.has(event.toolCallId)) {
              const fallbackToolName = event.toolName ?? "unknown";
              console.warn(
                `[Claude Agent API] Tool result for unregistered toolCallId "${event.toolCallId}" (toolName: ${fallbackToolName}). Auto-registering to prevent stream error.`
              );
              registeredToolCallIds.add(event.toolCallId);
              writeAndTrack({
                type: "tool-input-start",
                toolCallId: event.toolCallId,
                toolName: fallbackToolName,
              });
              writeAndTrack({
                type: "tool-input-available",
                toolCallId: event.toolCallId,
                toolName: fallbackToolName,
                input: {},
              });
            }

            writeAndTrack({
              type: "tool-output-available",
              toolCallId: event.toolCallId,
              output: event.output,
              providerExecuted: event.providerExecuted,
            });
          }

          // Forward tool_progress events - show elapsed time for long-running tools
          if (event.type === "tool_progress" && event.toolCallId) {
            safeWriteSSE({
              type: "message-metadata",
              messageMetadata: {
                unstable_data: {
                  type: "tool_progress",
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  elapsedTimeSeconds: (event.output as { elapsedTimeSeconds?: number })?.elapsedTimeSeconds,
                },
              },
            });
          }

          // Forward tool_use_summary events - human-readable multi-tool execution summary
          if (event.type === "tool_use_summary" && event.output) {
            const summaryOutput = event.output as { summary: string; precedingToolUseIds: string[] };
            const summaryId = createId("summary");
            writeAndTrack({ type: "text-start", id: summaryId });
            writeAndTrack({ type: "text-delta", id: summaryId, delta: summaryOutput.summary });
            writeAndTrack({ type: "text-end", id: summaryId });
          }

          // Forward result events - session completion statistics
          if (event.type === "result" && event.output) {
            const resultData = event.output as {
              subtype?: string;
              result?: string;
              isError?: boolean;
              durationMs?: number;
              numTurns?: number;
              totalCostUsd?: number;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            safeWriteSSE({
              type: "message-metadata",
              messageMetadata: {
                unstable_data: {
                  type: "session_result",
                  ...resultData,
                },
              },
            });
          }
        },
        onToolConfirmationRequest: async (event) => {
          // When manual tool confirmation is needed:
          // 1. Send tool events to frontend for review
          // 2. Block and wait for user confirmation via /api/claude-agent/tool-confirm
          // 3. Return the user's decision to the agent
          //
          // This implements the blocking pattern from: docs/Claude Agent SDK 交互式工具时序图.md
          // Backend creates Promise → blocks with await → frontend POSTs to confirm endpoint → Promise resolves

          // First: Send tool-input-start (AI SDK expects this before input-available)
          // Track registration to prevent duplicate tool-input-start from onToolEvent
          registeredToolCallIds.add(event.toolCallId);
          writeAndTrack({
            type: "tool-input-start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          });

          // Second: Send tool-input-available with the input
          writeAndTrack({
            type: "tool-input-available",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          });

          // Third: Send tool-approval-request
          const approvalId = createId("approval");
          writeAndTrack({
            type: "tool-approval-request",
            approvalId,
            toolCallId: event.toolCallId,
          });

          // BLOCK: Wait for user confirmation via /api/claude-agent/tool-confirm endpoint
          // This creates a Promise that resolves when the user clicks approve/reject
          // The frontend will POST to /api/claude-agent/tool-confirm to resolve this
          const confirmationResult = await createPendingToolConfirmation(
            event.toolCallId,
            event.toolName,
            event.input
          );

          // Return the user's decision to the agent
          return confirmationResult;
        },
        onError: async (error: Error) => {
          safeWriteSSE({
            type: "error",
            errorText: error.message,
          });
        },
      };

      try {
        // For new conversations, do not resume
        let shouldResume = false;
        let threadIdForAgent = conversationId;
        if (resume) {
          // Determine if we should resume an existing conversation
          // Use the stored claude_session_id if available
          shouldResume = !!existingConversation?.claude_session_id;
          threadIdForAgent = existingConversation?.claude_session_id ?? conversationId;
        }
        // Run the agent
        const result = await agentRunner.runStreaming(
          {
            threadId: threadIdForAgent,
            userMessage: messageText,
            resume: shouldResume,
            maxTurns: DEFAULT_MAX_TURNS,
            toolChoice: toolChoice as ToolChoiceMode,
            cwd: workspaceCwd,
            abortController,
            systemPrompt: systemPrompt || undefined,
            model: chatModel?.model,
            // Use default allowed tools from agent-runner (includes AskUserQuestion)
            // Don't pass allowedTools to use the defaults
          },
          callbacks
        );

        // Capture the session ID from the result
        capturedSessionId = result.sessionId;

        // Send final message-metadata event with updated toolCount
        // This complements the initial metadata sent at stream start
        // and provides the final tool count after all tools have been processed
        const finalMetadata: ChatMetadata = {
          toolChoice,
          toolCount: toolCallCount,
          chatModel,
          workspacePath: workspaceCwd,
          workspaceSessionId: conversationId,
        };
        safeWriteSSE({
          type: "message-metadata",
          messageMetadata: finalMetadata,
        });

        // Finish the message
        safeWriteSSE({
          type: "finish",
          finishReason: "stop",
        });
      } catch (error) {
        stopHeartbeat();
        if (isAbortError(error) || isAborted || req.signal.aborted || abortController.signal.aborted) {
          isAborted = true;
          console.info("[Claude Agent API] Stream aborted by client.");
          return;
        }

        console.error("Agent run error:", error);
        safeWriteSSE({
          type: "error",
          errorText:
            error instanceof Error ? error.message : "Unknown error occurred",
        });
      } finally {
        stopHeartbeat();
        isClosed = true;
        req.signal.removeEventListener("abort", onRequestAbort);
      }
    },

    // onFinish callback - save messages to database (following better-chatbot pattern)
    onFinish: async ({ responseMessage }) => {
      try {
        // Convert the user message parts for storage
        const userMessageParts = convertToStorageParts(uiMessage.parts);

        // Use the tracked streamedParts directly - these are EXACTLY as streamed
        // This preserves the order of text-delta and tool-input-start events
        const responseText = extractTextFromParts(responseMessage.parts);
        const assistantMessageParts = streamedParts.length > 0
          ? streamedParts
          : responseText
            ? [
              {
                type: "text" as const,
                text: responseText,
                state: "done" as const,
              },
            ]
            : [];

        // Get existing messages, excluding any with the same ID as the new messages
        // This prevents duplicate messages when updating a conversation
        const existingMessages = (existingConversation?.messages || [])
          .filter((m) => m.id !== uiMessage.id && m.id !== responseMessage.id)
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            parts: m.parts, // Now properly typed with MessagePart[]
            created_at: m.created_at,
          }));

        // Build the messages array for storage
        const storedMessages = [
          ...existingMessages,
          {
            id: uiMessage.id || createId("msg"),
            role: "user" as const,
            content: messageText,
            parts: userMessageParts,
            created_at: now,
          },
          {
            id: responseMessage.id || createId("msg"),
            role: "assistant" as const,
            content: responseText,
            parts: assistantMessageParts,
            created_at: new Date().toISOString(),
          },
        ];

        // Merge context customer IDs
        const mergedContextCustomerIds = [
          ...new Set([
            ...(existingConversation?.context_customer_ids || []),
            ...contextCustomerIds,
          ]),
        ];

        // Merge attachments
        const mergedAttachments = [
          ...(existingConversation?.attachments || []),
          ...dbAttachments,
        ];

        const conversationData: Conversation = {
          id: conversationId,
          title: existingConversation?.title ?? "与 AI 的对话",
          status: "pending",
          created_at: existingConversation?.created_at ?? now,
          updated_at: new Date().toISOString(),
          messages: storedMessages,
          attachments:
            mergedAttachments.length > 0 ? mergedAttachments : undefined,
          context_customer_ids:
            mergedContextCustomerIds.length > 0
              ? mergedContextCustomerIds
              : undefined,
          ai_outputs: existingConversation?.ai_outputs,
          linked_customer_id:
            existingConversation?.linked_customer_id ??
            (contextCustomerIds.length > 0 ? contextCustomerIds[0] : undefined),
          // Save the Claude SDK session_id for conversation resumption
          claude_session_id: capturedSessionId ?? existingConversation?.claude_session_id,
        };

        if (existingConversation) {
          await updateConversation(conversationData);
        } else {
          await createConversation(conversationData);
        }

        console.log(
          `[Claude Agent API] Conversation ${conversationId} saved with ${storedMessages.length} messages, session_id: ${conversationData.claude_session_id}`
        );
      } catch (error) {
        console.error("[Claude Agent API] Failed to save conversation:", error);
      }
    },

    onError: (error) => {
      // Log but do NOT re-throw. Re-throwing causes the stream to fail with
      // "failed to pipe response" and returns a 500 to the client.
      // Stream errors (e.g., AI_UIMessageStreamError from missing tool registrations)
      // should degrade gracefully rather than crashing the entire response.
      console.error("[Claude Agent API] Stream error (non-fatal):", error);
      return "Stream error occurred";
    },

    // Pass original message for context
    originalMessages: [uiMessage],
  });

  // Return streaming response
  return createClaudeAgentSSEStreamResponse({
    stream,
    headers: {
      "X-Conversation-Id": conversationId,
    },
  });
}
