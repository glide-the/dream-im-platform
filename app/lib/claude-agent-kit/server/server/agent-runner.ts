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
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { buildUserMessageContent } from "../../messages/messages/build-user-message-content";
import type { IClaudeAgentSDKClient, SessionSDKOptions } from "../types";
import { SimpleClaudeAgentSDKClient } from "./simple-cas-client";

/**
 * Tool event payload for streaming
 * Extended to include all parameters that might be present in tool calls
 */
export interface ToolEventPayload {
  type: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  state?: "input-available" | "input-streaming" | "output-available" | "output-error" | "error";
  isError?: boolean;
  // Extended parameters
  title?: string;
  providerExecuted?: boolean;
  /** Stop reason from message_delta events (e.g. "end_turn", "tool_use") */
  stopReason?: string;
}

/**
 * Callbacks for streaming responses
 */
export interface AgentStreamingCallbacks {
  /** Called when text delta is received */
  onTextDelta: (delta: string) => Promise<void> | void;
  /** Called when full text is complete */
  onTextDone?: (fullText: string) => Promise<void> | void;
  /** Called when a tool event is received */
  onToolEvent?: (event: ToolEventPayload) => Promise<void> | void;
  /** 
   * Called when a tool call needs manual confirmation.
   * This is triggered when toolChoice="manual" and a tool call is proposed.
   * 
   * Returns a confirmation result indicating whether the tool should be executed.
   * The callback should block (await) until user confirmation is received.
   * If undefined is returned, the tool will NOT be auto-executed.
   * 
   * For interactive tools like AskUserQuestion, the answers field contains
   * the user's responses which will be passed as the tool result.
   */
  onToolConfirmationRequest?: (event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<{ approved: boolean; reason?: string; answers?: Record<string, unknown> } | void> | { approved: boolean; reason?: string; answers?: Record<string, unknown> } | void;
  /** Called when an error occurs */
  onError?: (error: Error) => Promise<void> | void;
  /** Called when any message is received (for logging) */
  onMessage?: (message: SDKMessage) => Promise<void> | void;
}

/**
 * Tool choice mode - determines how tool calls are handled
 */
export type ToolChoiceMode = "auto" | "none" | "manual";

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
  /** 
   * Tool choice mode:
   * - "auto": AI decides when to use tools
   * - "none": No tool usage allowed
   * - "manual": Tool calls require user confirmation
   */
  toolChoice?: ToolChoiceMode;
  /** Abort controller for cancellation */
  abortController?: AbortController;
  /** System prompt override — passed to the SDK as `systemPrompt` */
  systemPrompt?: string;
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
  // Interactive user confirmation tools
  "mcp__user__ask_user",
  "AskUserQuestion",
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
      toolChoice = "auto",
      abortController,
      systemPrompt,
    } = opts;
    const includePartialMessages = true;
    const messages: SDKMessage[] = [];
    let fullText = "";
    // In Claude Agent SDK, session_id and threadId are the same thing
    let currentSessionId: string | null = threadId;
    let success = true;
    let runError: Error | undefined;
    // Accumulate token usage from stream events and result
    const usage: { inputTokens?: number; outputTokens?: number } = {};

    // Track pending tool calls for manual confirmation mode
    const pendingToolCalls: Map<string, { toolName: string; input: Record<string, unknown> }> = new Map();

    // Build the user message
    // session_id in SDKUserMessage is the thread/conversation identifier
    const userMsg: SDKUserMessage = {
      type: "user",
      uuid: randomUUID(),
      session_id: threadId,  // threadId IS the session_id
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: buildUserMessageContent(userMessage, undefined, {
          cwd,
          model,
          maxTurns,
          threadId,
          resume,
        }),
      },
    };

    // Create message generator
    async function* generateMessages(): AsyncIterable<SDKUserMessage> {
      yield userMsg;
    }

    // When toolChoice is "none", disable all tools
    const effectiveAllowedTools = toolChoice === "none" ? [] : allowedTools;

    // Create canUseTool callback for manual tool confirmation mode
    // This is the official SDK permission handler called before each tool execution
    // Reference: https://platform.claude.com/docs/en/agent-sdk/user-input
    const canUseTool: CanUseTool | undefined = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      options: {
        signal: AbortSignal;
        toolUseID: string;
        suggestions?: unknown[];
        blockedPath?: string;
        decisionReason?: string;
        agentID?: string;
      }
    ): Promise<PermissionResult> => {
      const toolCallId = options.toolUseID;

      // Store pending tool call
      pendingToolCalls.set(toolCallId, { toolName, input: toolInput });


      // Call the confirmation callback and WAIT for user response
      // This blocks until the user approves or rejects
      if (callbacks.onToolConfirmationRequest) {
        const confirmationResult = await callbacks.onToolConfirmationRequest({
          toolCallId,
          toolName,
          input: toolInput,
        });

        // Type guard: check if we got a valid result object
        if (confirmationResult && typeof confirmationResult === 'object' && 'approved' in confirmationResult) {
          if (confirmationResult.approved === true) {
            // User approved - allow tool execution
            pendingToolCalls.delete(toolCallId);

            // For AskUserQuestion tool, format the response per Claude Agent SDK spec:
            // updatedInput = { questions: [...], answers: { "question text": "selected label" } }
            const hasAnswers = confirmationResult.answers && Object.keys(confirmationResult.answers).length > 0;

            let updatedInput = toolInput;
            if (hasAnswers && (toolName === 'AskUserQuestion' || toolName === 'mcp__user__ask_user')) {
              // Per Claude Agent SDK: answers keys must be the question text, values are selected option labels
              updatedInput = {
                questions: toolInput.questions, // Pass through original questions array
                answers: confirmationResult.answers,
              };
            }

            return {
              behavior: 'allow',
              toolUseID: toolCallId,
              updatedInput,
            };
          } else if (confirmationResult.approved === false) {
            // User rejected - deny tool execution
            pendingToolCalls.delete(toolCallId);
            const reason = confirmationResult.reason || "用户拒绝执行该工具";
            return {
              behavior: 'deny',
              message: reason,
              toolUseID: toolCallId,
            };
          }
        }
      }

      // No confirmation callback or no result - default to deny
      pendingToolCalls.delete(toolCallId);
      return {
        behavior: 'deny',
        message: '需要用户确认但未收到响应',
        toolUseID: toolCallId,
      };
    }


    // Build SDK options
    // When resume is true, use threadId as the session to resume
    const sdkOptions: Partial<SDKOptions> = {
      maxTurns,
      allowedTools: effectiveAllowedTools,
      settingSources: ["project"],
      // permissionMode: toolChoice === "manual" ? "bypassPermissions" : "dontAsk",
      ...(cwd ? { cwd } : { cwd: process.cwd() }),
      ...(resume ? { resume: threadId } : {}),  // Use threadId for resume since they're the same
      ...(abortController ? { abortController } : {}),
      // Add canUseTool callback for manual confirmation mode
      ...(canUseTool ? { canUseTool } : {}),
      includePartialMessages: includePartialMessages,
      // System config: model & system prompt
      ...(model ? { model } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
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
        await this.processMessage(message, callbacks, toolChoice, pendingToolCalls, (delta) => {
          fullText += delta;
        }, includePartialMessages, usage);
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
      usage: (usage.inputTokens || usage.outputTokens) ? usage : undefined,
    };
  }

  /**
   * Process a single message and trigger appropriate callbacks
   */
  private async processMessage(
    message: SDKMessage,
    callbacks: AgentStreamingCallbacks,
    toolChoice: ToolChoiceMode,
    pendingToolCalls: Map<string, { toolName: string; input: Record<string, unknown> }>,
    onTextAccumulate: (delta: string) => void,
    /** 开启时 assistant 消息的文本已通过 stream_event 增量输出，跳过以避免重复 */
    includePartialMessages = false,
    usageAccumulator: { inputTokens?: number; outputTokens?: number } = {}
  ): Promise<void> {
    switch (message.type) {
      case "assistant": {
        // Extract text from assistant message content
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              // includePartialMessages 开启时，文本已通过 stream_event (text_delta) 增量输出，
              // assistant 消息只是累积的 partial message，跳过以避免重复
              if (!includePartialMessages) {
                onTextAccumulate(block.text);
                await callbacks.onTextDelta(block.text);
              }
            } else if (block.type === "thinking" && callbacks.onToolEvent) {
              // Handle thinking content blocks
              const thinkingBlock = block as { type: "thinking"; thinking: string };
              if (typeof thinkingBlock.thinking === "string") {
                await callbacks.onToolEvent({
                  type: "thinking",
                  output: thinkingBlock.thinking,
                });
              }
            } else if (block.type === "tool_use") {
              const toolCallId = block.id;
              const toolName = block.name;
              const input = block.input as Record<string, unknown>;

              // In manual mode, the PreToolUse hook handles confirmation before tool execution.
              // Here we just report the tool_use event for UI display.
              // The hook will block and wait for user approval, then either:
              // - Allow: tool executes and we'll receive tool_result later
              // - Deny: tool is blocked and Claude receives the rejection
              if (callbacks.onToolEvent) {
                await callbacks.onToolEvent({
                  type: "tool_use",
                  toolName,
                  toolCallId,
                  input,
                });
              }
            }
            // Note: tool_result blocks appear in "user" messages, NOT in "assistant" messages.
            // See the "user" case below for tool_result handling.
          }
        } else if (typeof content === "string") {
          // 同上：includePartialMessages 时跳过 assistant 文本
          if (!includePartialMessages) {
            onTextAccumulate(content);
            await callbacks.onTextDelta(content);
          }
        }
        break;
      }

      case "stream_event": {
        // Handle streaming events — see docs/design/Claude SDK Message 事件类型层级.md
        // stream_event contains 6 inner event types:
        //   message_start, content_block_start, content_block_delta,
        //   content_block_stop, message_delta, message_stop
        const streamMsg = message as unknown as {
          type: "stream_event";
          event: {
            type: string;
            // content_block_delta fields
            delta?: {
              type: string;
              text?: string;
              partial_json?: string;
              // message_delta fields
              stop_reason?: string;
              stop_sequence?: string | null;
            };
            index?: number;
            // content_block_start fields
            content_block?: { type: string; id?: string; name?: string; input?: unknown; text?: string };
            // message_start fields
            message?: {
              type?: string;
              role?: string;
              model?: string;
              id?: string;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            // message_delta usage fields
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
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
          if (event.content_block.type === "tool_use") {
            // Tool use block start
            const toolCallId = event.content_block.id;
            const toolName = event.content_block.name;
            const input = event.content_block.input as Record<string, unknown> | undefined;

            if (toolChoice === "manual" && toolCallId && toolName) {
              // Store for manual confirmation
              pendingToolCalls.set(toolCallId, {
                toolName,
                input: input ?? {}
              });
            }

            if (callbacks.onToolEvent) {
              await callbacks.onToolEvent({
                type: "tool_use_start",
                toolName: toolName ?? undefined,
                toolCallId: toolCallId ?? undefined,
                input,
                state: toolChoice === "manual" ? "input-available" : undefined,
              });
            }
          } else if (event.content_block.type === "text" && callbacks.onToolEvent) {
            // Text block start
            await callbacks.onToolEvent({
              type: "text_block_start",
              output: { index: event.index },
            });
          }
        } else if (event.type === "content_block_stop") {
          // Content block end — signals tool_use input JSON is complete or text block finished
          if (callbacks.onToolEvent) {
            await callbacks.onToolEvent({
              type: "content_block_stop",
              output: { index: event.index },
            });
          }
        } else if (event.type === "message_start") {
          // Message start — carries model & initial usage (input_tokens)
          if (event.message?.usage?.input_tokens) {
            usageAccumulator.inputTokens = (usageAccumulator.inputTokens ?? 0) + event.message.usage.input_tokens;
          }
          if (callbacks.onToolEvent) {
            await callbacks.onToolEvent({
              type: "message_start",
              output: {
                model: event.message?.model,
                usage: event.message?.usage,
              },
            });
          }
        } else if (event.type === "message_delta") {
          // Message-level delta — carries stop_reason and cumulative output_tokens
          if (event.usage?.output_tokens) {
            usageAccumulator.outputTokens = (usageAccumulator.outputTokens ?? 0) + event.usage.output_tokens;
          }
          if (callbacks.onToolEvent) {
            await callbacks.onToolEvent({
              type: "message_delta",
              output: {
                stopReason: event.delta?.stop_reason,
                usage: event.usage,
              },
              stopReason: event.delta?.stop_reason,
            });
          }
        } else if (event.type === "message_stop") {
          // Message end marker
          if (callbacks.onToolEvent) {
            await callbacks.onToolEvent({
              type: "message_stop",
            });
          }
        }
        break;
      }

      case "result": {
        // Session result (subtype: success/error), NOT a tool result.
        // Tool results come in "user" messages with tool_result content blocks.
        const resultMsg = message as unknown as {
          type: "result";
          subtype?: string;
          is_error?: boolean;
          duration_ms?: number;
          num_turns?: number;
          result?: string;
          total_cost_usd?: number;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
          };
        };

        // Populate usage from the cumulative result event (overrides stream-level values)
        if (resultMsg.usage) {
          if (resultMsg.usage.input_tokens) {
            usageAccumulator.inputTokens = resultMsg.usage.input_tokens;
          }
          if (resultMsg.usage.output_tokens) {
            usageAccumulator.outputTokens = resultMsg.usage.output_tokens;
          }
        }

        if (callbacks.onToolEvent) {
          await callbacks.onToolEvent({
            type: "result",
            output: {
              subtype: resultMsg.subtype,
              result: resultMsg.result,
              isError: resultMsg.is_error,
              durationMs: resultMsg.duration_ms,
              numTurns: resultMsg.num_turns,
              totalCostUsd: resultMsg.total_cost_usd,
              usage: resultMsg.usage,
            },
            state: resultMsg.is_error ? "output-error" : "output-available",
            isError: resultMsg.is_error,
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
        // User messages contain tool_result content blocks (tool execution results)
        // Per SDK docs: user messages have tool_result type content with tool_use_id and output
        const userMsg = message as unknown as {
          type: "user";
          message?: {
            role: string;
            content?: Array<{
              type: string;
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            }>;
          };
          tool_use_result?: {
            stdout?: string;
            stderr?: string;
            interrupted?: boolean;
          };
        };

        const userContent = userMsg.message?.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === "tool_result" && block.tool_use_id && callbacks.onToolEvent) {
              // Remove from pending if it was there
              pendingToolCalls.delete(block.tool_use_id);

              await callbacks.onToolEvent({
                type: "tool_result",
                toolCallId: block.tool_use_id,
                output: block.content,
                isError: block.is_error ?? false,
                state: block.is_error ? "output-error" : "output-available",
              });
            }
          }
        }
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
