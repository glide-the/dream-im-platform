"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { getToolName, type ToolUIPart, type DynamicToolUIPart } from "ai";
import { IconChevronDown, IconChevronUp } from "./Icons";
import {
  ManualToolConfirmTag,
  type ChatMetadata,
} from "../lib/chat-schema";

// Union type for tool parts
type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

/**
 * Helper to call the tool confirmation API
 * This sends the user's decision to the backend which unblocks the waiting agent
 */
async function confirmToolCall(
  toolCallId: string,
  approved: boolean,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch("/api/claude-agent/tool-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolCallId, approved, reason }),
  });
  return response.json();
}

/**
 * Tool icon component
 */
function IconTool({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

/**
 * Check icon component
 */
function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Loader/spinner icon component
 */
function IconLoader({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Alert/warning icon component
 */
function IconAlert({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * X icon component
 */
function IconClose({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface ToolMessagePartProps {
  /** The tool invocation part from AI SDK */
  part: AnyToolUIPart;
  /** Whether this is the last message in the conversation */
  isLast?: boolean;
  /** Whether the conversation is currently loading/streaming */
  isLoading?: boolean;
  /** Whether this should show manual tool confirmation UI */
  isManualToolInvocation?: boolean;
  /** Callback to add tool result (for manual confirmation) */
  addToolResult?: (params: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => void;
}

/**
 * ToolMessagePart component - renders tool invocations in the chat UI
 * 
 * This component follows the pattern from cgoinglove/better-chatbot's ToolMessagePart.
 * When `isManualToolInvocation` is true, it shows Approve/Reject buttons.
 * 
 * Reference: cgoinglove/better-chatbot src/components/message-parts.tsx
 */
export function ToolMessagePart({
  part,
  isLast,
  isLoading,
  isManualToolInvocation,
  addToolResult,
}: ToolMessagePartProps) {
  const [expanded, setExpanded] = useState(false);

  // Extract toolCallId and toolName
  const toolCallId = part.toolCallId;
  const toolName = getToolName(part);

  // Extract input and output based on part state
  const input = 'input' in part ? part.input : undefined;
  const output = 'output' in part ? part.output : undefined;
  const state = part.state;

  // Extract extended parameters
  const title = 'title' in part ? (part as { title?: string }).title : undefined;
  const providerExecuted = 'providerExecuted' in part ? (part as { providerExecuted?: boolean }).providerExecuted : undefined;
  const partType = part.type; // Preserve original type for display

  // Determine if we should show the approval UI
  // The parent component (page.tsx) passes isManualToolInvocation=true when:
  // 1. The tool is in "input-available" state
  // 2. It's the last message and still streaming
  // This means the backend is waiting for user confirmation
  const shouldShowApprovalUI = isManualToolInvocation === true || partType === 'tool-AskUserQuestion';

  // Determine if the tool is completed (has output)
  const isCompleted = useMemo(() => {
    return state === "output-available" || state === "output-error";
  }, [state]);

  // Determine if the tool is currently executing
  const isExecuting = useMemo(() => {
    return !isCompleted && isLast && isLoading;
  }, [isCompleted, isLast, isLoading]);

  // Determine if there's an error
  const isError = useMemo(() => {
    return state === "output-error";
  }, [state]);

  // Format input for display
  const inputDisplay = useMemo(() => {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }, [input]);

  // Format output for display
  const outputDisplay = useMemo(() => {
    if (!output) return null;
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }, [output]);

  // Local state for confirmation status
  const [confirmationStatus, setConfirmationStatus] = useState<"idle" | "confirming" | "confirmed" | "rejected">("idle");

  // Handle approve action - calls the backend confirmation API
  const handleApprove = useCallback(async () => {
    if (confirmationStatus !== "idle") return;

    setConfirmationStatus("confirming");
    try {
      const result = await confirmToolCall(toolCallId, true);
      if (result.success) {
        setConfirmationStatus("confirmed");
      } else {
        console.error("Tool confirmation failed:", result.message);
        setConfirmationStatus("idle"); // Reset to allow retry
      }
    } catch (error) {
      console.error("Tool confirmation error:", error);
      setConfirmationStatus("idle"); // Reset to allow retry
    }
  }, [toolCallId, confirmationStatus]);

  // Handle reject action - calls the backend confirmation API
  const handleReject = useCallback(async () => {
    if (confirmationStatus !== "idle") return;

    setConfirmationStatus("confirming");
    try {
      const result = await confirmToolCall(toolCallId, false, "用户拒绝执行工具");
      if (result.success) {
        setConfirmationStatus("rejected");
      } else {
        console.error("Tool rejection failed:", result.message);
        setConfirmationStatus("idle"); // Reset to allow retry
      }
    } catch (error) {
      console.error("Tool rejection error:", error);
      setConfirmationStatus("idle"); // Reset to allow retry
    }
  }, [toolCallId, confirmationStatus]);

  // Keyboard shortcuts for approve/reject
  useEffect(() => {
    if (!shouldShowApprovalUI) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Enter to approve
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleApprove();
      }
      // Cmd/Ctrl + Escape to reject
      if ((e.metaKey || e.ctrlKey) && e.key === "Escape") {
        e.preventDefault();
        handleReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shouldShowApprovalUI, handleApprove, handleReject]);

  return (
    <div className="group w-full">
      <div className="flex flex-col rounded-lg border border-border bg-bg-surface">
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="p-1.5 rounded bg-bg-secondary">
            {isExecuting ? (
              <IconLoader className="h-3.5 w-3.5 text-accent animate-spin" />
            ) : isError ? (
              <IconAlert className="h-3.5 w-3.5 text-red-500" />
            ) : (
              <IconTool className="h-3.5 w-3.5 text-text-secondary" />
            )}
          </div>
          <div className="flex-1">
            <span className="font-medium text-sm text-text-primary">
              {isExecuting ? (
                <span className="text-accent">{title || toolName}</span>
              ) : (
                title || toolName
              )}
            </span>
            {/* Show tool type and provider info as extended parameters */}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-text-tertiary">{partType}</span>
              {providerExecuted !== undefined && (
                <span className="text-xs text-text-tertiary">
                  {providerExecuted ? "• 提供者执行" : "• 本地执行"}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded hover:bg-bg-secondary transition-colors"
          >
            {expanded ? (
              <IconChevronUp className="h-4 w-4 text-text-tertiary" />
            ) : (
              <IconChevronDown className="h-4 w-4 text-text-tertiary" />
            )}
          </button>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="px-3 pb-3 space-y-2">
            {/* Extended parameters section */}
            <div className="rounded-lg border border-border bg-bg-secondary p-3">
              <h5 className="text-xs font-medium text-text-tertiary mb-2">
                工具信息
              </h5>
              <div className="text-xs text-text-secondary space-y-1">
                <div><span className="text-text-tertiary">类型:</span> {partType}</div>
                <div><span className="text-text-tertiary">工具名:</span> {toolName}</div>
                <div><span className="text-text-tertiary">调用ID:</span> <code className="bg-bg-primary px-1 rounded">{toolCallId}</code></div>
                <div><span className="text-text-tertiary">状态:</span> {state}</div>
                {title && <div><span className="text-text-tertiary">标题:</span> {title}</div>}
                {providerExecuted !== undefined && (
                  <div><span className="text-text-tertiary">执行方:</span> {providerExecuted ? "提供者" : "本地"}</div>
                )}
              </div>
            </div>

            {/* Input section */}
            <div className="rounded-lg border border-border bg-bg-secondary p-3">
              <h5 className="text-xs font-medium text-text-tertiary mb-2">
                输入参数
              </h5>
              <pre className="text-xs text-text-secondary overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {inputDisplay}
              </pre>
            </div>

            {/* Output section (if available) */}
            {outputDisplay && (
              <div className="rounded-lg border border-border bg-bg-secondary p-3">
                <h5 className="text-xs font-medium text-text-tertiary mb-2">
                  {isError ? "错误信息" : "输出结果"}
                </h5>
                <pre className={`text-xs overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap ${isError ? "text-red-500" : "text-text-secondary"}`}>
                  {outputDisplay}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Manual tool confirmation buttons */}
        {shouldShowApprovalUI && confirmationStatus === "idle" && (
          <div className="px-3 pb-3 flex flex-row gap-2 items-center">
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 transition-colors"
              onClick={handleApprove}
            >
              <IconCheck className="h-4 w-4" />
              确认执行
              <span className="text-white/70 text-xs ml-1">⌘↵</span>
            </button>
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-2 rounded-full border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-secondary transition-colors"
              onClick={handleReject}
            >
              <IconClose className="h-4 w-4" />
              取消
              <span className="text-text-tertiary text-xs ml-1">⌘⎋</span>
            </button>
          </div>
        )}

        {/* Confirmation in progress */}
        {shouldShowApprovalUI && confirmationStatus === "confirming" && (
          <div className="px-3 pb-3 flex items-center justify-center gap-2 text-sm text-accent">
            <IconLoader className="h-4 w-4 animate-spin" />
            <span>处理中...</span>
          </div>
        )}

        {/* Confirmed status */}
        {shouldShowApprovalUI && confirmationStatus === "confirmed" && (
          <div className="px-3 pb-3 flex items-center justify-center gap-2 text-sm text-green-600">
            <IconCheck className="h-4 w-4" />
            <span>已确认，工具执行中</span>
          </div>
        )}

        {/* Rejected status */}
        {shouldShowApprovalUI && confirmationStatus === "rejected" && (
          <div className="px-3 pb-3 flex items-center justify-center gap-2 text-sm text-red-500">
            <IconClose className="h-4 w-4" />
            <span>已取消</span>
          </div>
        )}

        {/* Status indicator */}
        {isExecuting && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 text-xs text-accent">
              <IconLoader className="h-3 w-3 animate-spin" />
              <span>执行中...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default ToolMessagePart;
