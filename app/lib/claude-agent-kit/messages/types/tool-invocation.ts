/**
 * Tool Invocation Stream Types
 * 
 * Types for streaming tool call events in the AI chat flow.
 * These types support the manual tool confirmation workflow where:
 * 1. AI proposes a tool call (state: "input-available")
 * 2. Frontend shows Approve/Reject controls
 * 3. User confirms or rejects
 * 4. Backend executes tool (if confirmed) or returns rejection prompt
 * 
 * Reference: cgoinglove/better-chatbot and Vercel AI SDK patterns
 */

// Re-export the core types from chat-schema to avoid duplication
export {
  ManualToolConfirmTag,
  MANUAL_REJECT_RESPONSE_PROMPT,
  type ToolInvocationState,
} from "../../../chat-schema";

import { ManualToolConfirmTag as _ManualToolConfirmTag } from "../../../chat-schema";

/**
 * Tool call stream event - sent when AI proposes a tool call
 */
export interface ToolCallStartEvent {
  type: "tool-call-start";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Tool call input delta - sent during streaming of tool input
 */
export interface ToolCallInputDeltaEvent {
  type: "tool-call-input-delta";
  toolCallId: string;
  delta: string;
}

/**
 * Tool output available event - sent when tool execution completes
 */
export interface ToolOutputAvailableEvent {
  type: "tool-output-available";
  toolCallId: string;
  output: unknown;
  isError?: boolean;
}

/**
 * Tool confirmation request - sent when manual confirmation is needed
 */
export interface ToolConfirmationRequestEvent {
  type: "tool-confirmation-request";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Union of all tool-related stream events
 */
export type ToolStreamEvent = 
  | ToolCallStartEvent
  | ToolCallInputDeltaEvent
  | ToolOutputAvailableEvent
  | ToolConfirmationRequestEvent;

/**
 * Manual tool confirmation payload
 * Sent by frontend when user approves or rejects a tool call
 */
export interface ManualToolConfirmPayload {
  confirm: boolean;
}

/**
 * Check if a value is a manual tool confirmation
 */
export function isManualToolConfirm(value: unknown): value is ManualToolConfirmPayload & { __$ref__: string } {
  return _ManualToolConfirmTag.isMaybe(value);
}

/**
 * Create a manual tool confirmation
 */
export function createManualToolConfirm(confirm: boolean) {
  return _ManualToolConfirmTag.create({ confirm });
}

/**
 * Tool result payload for addToolResult callback
 */
export interface AddToolResultPayload {
  toolCallId: string;
  result: unknown;
}

/**
 * Tool confirmation result for manual tool invocation
 * Uses ReturnType to get the actual type from createManualToolConfirm
 */
export interface ToolConfirmationResult extends AddToolResultPayload {
  result: ReturnType<typeof createManualToolConfirm>;
}
