/**
 * Claude Agent Runner
 * Unified interface for running Claude agent with streaming support
 * 
 * This wraps the Session + SimpleClaudeAgentSDKClient to provide
 * a clean streaming callback interface for the AI worker.
 */
import type {
  SDKMessage,
  SDKUserMessage,
  Options as SDKOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { buildUserMessageContent } from "../../messages/messages/build-user-message-content";
import type { IClaudeAgentSDKClient, SessionSDKOptions } from "../types";
import { SimpleClaudeAgentSDKClient } from "./simple-cas-client";

/**
 * Callbacks for streaming responses
 */
export interface AgentStreamingCallbacks {
  /** Called when text delta is received */
  onTextDelta: (delta: string) => Promise<void> | void;
  /** Called when full text is complete */
  onTextDone?: (fullText: string) => Promise<void> | void;
  /** Called when a tool event is received */
  onToolEvent?: (event: {
    type: string;
    toolName?: string;
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
  }) => Promise<void> | void;
  /** Called when an error occurs */
  onError?: (error: Error) => Promise<void> | void;
  /** Called when any message is received (for logging) */
  onMessage?: (message: SDKMessage) => Promise<void> | void;
}

/**
 * Options for running the agent
 */
export interface AgentRunOptions {
  /** 
   * Thread ID for conversation context.
   * In Claude Agent SDK, this is the session_id - they are the same thing.
   * When resuming a conversation, this same ID is used.
   */
  threadId: string;
  /** User's message text */
  userMessage: string;
  /** 
   * Whether to resume an existing conversation.
   * When true, the threadId will be used to resume the session.
   */
  resume?: boolean;
  /** Model to use */
  model?: string;
  /** Working directory for agent */
  cwd?: string;
  /** Maximum turns for the agent */
  maxTurns?: number;
  /** Allowed tools for the agent */
  allowedTools?: string[];
  /** Abort controller for cancellation */
  abortController?: AbortController;
}

/**
 * Result from agent run
 */
export interface AgentRunResult {
  /** Full text response */
  fullText: string;
  /** 
   * Session ID from the Claude Agent SDK response.
   * This is the same as threadId - in Claude Agent SDK, session_id and thread ID are identical.
   * Can be used with `resume: true` option to continue the conversation.
   */
  sessionId: string | null;
  /** Whether the run completed successfully */
  success: boolean;
  /** Error if any */
  error?: Error;
  /** All messages from the run */
  messages: SDKMessage[];
  /** Token usage statistics */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  "Task",
  "Bash",
  "Glob",
  "Grep",
  "LS",
  "ExitPlanMode",
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "TodoWrite",
  "WebSearch",
  "BashOutput",
  "KillBash",
];

/**
 * Claude Agent Runner
 * Provides a simplified interface for running Claude agent with streaming
 */
export class ClaudeAgentRunner {
  private sdkClient: IClaudeAgentSDKClient;

  constructor(sdkClient?: IClaudeAgentSDKClient) {
    this.sdkClient = sdkClient || new SimpleClaudeAgentSDKClient();
  }

  /**
   * Run the agent with streaming callbacks
   */
  async runStreaming(
    opts: AgentRunOptions,
    callbacks: AgentStreamingCallbacks
  ): Promise<AgentRunResult> {
    const {
      threadId,
      userMessage,
      resume,
      model,
      cwd,
      maxTurns = 100,
      allowedTools = [...DEFAULT_ALLOWED_TOOLS],
      abortController,
    } = opts;

    const messages: SDKMessage[] = [];
    let fullText = "";
    // In Claude Agent SDK, session_id and threadId are the same thing
    let currentSessionId: string | null = threadId;
    let success = true;
    let runError: Error | undefined;

    // Build the user message
    // session_id in SDKUserMessage is the thread/conversation identifier
    const userMsg: SDKUserMessage = {
      type: "user",
      uuid: randomUUID(),
      session_id: threadId,  // threadId IS the session_id
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: buildUserMessageContent(userMessage, undefined),
      },
    };

    // Create message generator
    async function* generateMessages(): AsyncIterable<SDKUserMessage> {
      yield userMsg;
    }

    // Build SDK options
    // When resume is true, use threadId as the session to resume
    const sdkOptions: Partial<SDKOptions> = {
      maxTurns,
      allowedTools, 
      settingSources: ["project"],
      permissionMode: "default",
      ...(cwd ? { cwd } : { cwd: process.cwd() }),
      ...(resume ? { resume: threadId } : {}),  // Use threadId for resume since they're the same
      ...(abortController ? { abortController } : {}),
    };

    try {
      for await (const message of this.sdkClient.queryStream(
        generateMessages(),
        sdkOptions
      )) {
        messages.push(message);

        // Update session ID if present
        if (message.session_id) {
          currentSessionId = message.session_id;
        }

        // Notify callback of raw message
        if (callbacks.onMessage) {
          await callbacks.onMessage(message);
        }

        // Process message based on type
        await this.processMessage(message, callbacks, (delta) => {
          fullText += delta;
        });
      }

      // Call onTextDone if we accumulated any text
      if (fullText && callbacks.onTextDone) {
        await callbacks.onTextDone(fullText);
      }
    } catch (error) {
      success = false;
      runError = error instanceof Error ? error : new Error(String(error));
      
      if (callbacks.onError) {
        await callbacks.onError(runError);
      }
    }

    return {
      fullText,
      sessionId: currentSessionId,
      success,
      error: runError,
      messages,
    };
  }

  /**
   * Process a single message and trigger appropriate callbacks
   */
  private async processMessage(
    message: SDKMessage,
    callbacks: AgentStreamingCallbacks,
    onTextAccumulate: (delta: string) => void
  ): Promise<void> {
    switch (message.type) {
      case "assistant": {
        // Extract text from assistant message content
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              onTextAccumulate(block.text);
              await callbacks.onTextDelta(block.text);
            } else if (block.type === "thinking" && callbacks.onToolEvent) {
              // Handle thinking content blocks
              const thinkingBlock = block as { type: "thinking"; thinking: string };
              if (typeof thinkingBlock.thinking === "string") {
                await callbacks.onToolEvent({
                  type: "thinking",
                  output: thinkingBlock.thinking,
                });
              }
            } else if (block.type === "tool_use" && callbacks.onToolEvent) {
              await callbacks.onToolEvent({
                type: "tool_use",
                toolName: block.name,
                toolCallId: block.id,
                input: block.input,
              });
            } else if (block.type === "tool_result" && callbacks.onToolEvent) {
              // Handle tool_result content blocks
              const toolResultBlock = block as { 
                type: "tool_result"; 
                tool_use_id: string; 
                content?: unknown;
              };
              await callbacks.onToolEvent({
                type: "tool_result",
                toolCallId: toolResultBlock.tool_use_id,
                output: toolResultBlock.content,
              });
            }
          }
        } else if (typeof content === "string") {
          onTextAccumulate(content);
          await callbacks.onTextDelta(content);
        }
        break;
      }

      case "stream_event": {
        // Handle streaming events (SDKPartialAssistantMessage)
        const streamMsg = message as unknown as { 
          type: "stream_event"; 
          event: { 
            type: string; 
            delta?: { type: string; text?: string; partial_json?: string };
            index?: number;
            content_block?: { type: string; id?: string; name?: string; input?: unknown };
          } 
        };
        const event = streamMsg.event;
        
        if (event.type === "content_block_delta" && event.delta) {
          // Handle text deltas
          if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
            onTextAccumulate(event.delta.text);
            await callbacks.onTextDelta(event.delta.text);
          }
          // Handle thinking deltas
          else if (event.delta.type === "thinking_delta" && typeof event.delta.text === "string") {
            if (callbacks.onToolEvent) {
              await callbacks.onToolEvent({
                type: "thinking_delta",
                output: event.delta.text,
              });
            }
          }
          // Handle tool input deltas
          else if (event.delta.type === "input_json_delta" && callbacks.onToolEvent) {
            await callbacks.onToolEvent({
              type: "tool_input_delta",
              output: event.delta.partial_json,
            });
          }
        } else if (event.type === "content_block_start" && event.content_block) {
          // Handle content block start events for tool use
          if (event.content_block.type === "tool_use" && callbacks.onToolEvent) {
            await callbacks.onToolEvent({
              type: "tool_use_start",
              toolName: event.content_block.name ?? undefined,
              toolCallId: event.content_block.id ?? undefined,
              input: event.content_block.input,
            });
          }
        }
        break;
      }

      case "result": {
        // Tool result
        if (callbacks.onToolEvent) {
          await callbacks.onToolEvent({
            type: "tool_result",
            output: (message as unknown as { result?: unknown }).result,
          });
        }
        break;
      }

      case "tool_progress": {
        // Handle tool progress messages
        if (callbacks.onToolEvent) {
          const progressMsg = message as unknown as {
            type: "tool_progress";
            tool_use_id: string;
            tool_name: string;
            elapsed_time_seconds: number;
          };
          await callbacks.onToolEvent({
            type: "tool_progress",
            toolName: progressMsg.tool_name,
            toolCallId: progressMsg.tool_use_id,
            output: { elapsedTimeSeconds: progressMsg.elapsed_time_seconds },
          });
        }
        break;
      }

      case "tool_use_summary": {
        // Handle tool use summary messages
        if (callbacks.onToolEvent) {
          const summaryMsg = message as unknown as {
            type: "tool_use_summary";
            summary: string;
            preceding_tool_use_ids: string[];
          };
          await callbacks.onToolEvent({
            type: "tool_use_summary",
            output: {
              summary: summaryMsg.summary,
              precedingToolUseIds: summaryMsg.preceding_tool_use_ids,
            },
          });
        }
        break;
      }

      case "system": {
        // System messages (init, etc.) - can be logged but typically not streamed
        break;
      }

      case "user": {
        // User messages - typically not processed for output callbacks
        break;
      }

      case "auth_status": {
        // Auth status messages - can be logged but typically not streamed
        break;
      }

      default:
        // Other message types (e.g., system subtypes like compact_boundary, status, etc.)
        break;
    }
  }

  /**
   * Load message history for a session
   */
  async loadMessages(sessionId: string): Promise<SDKMessage[]> {
    const result = await this.sdkClient.loadMessages(sessionId);
    return result.messages;
  }
}

/**
 * Create a new ClaudeAgentRunner instance
 */
export function createAgentRunner(sdkClient?: IClaudeAgentSDKClient): ClaudeAgentRunner {
  return new ClaudeAgentRunner(sdkClient);
}
