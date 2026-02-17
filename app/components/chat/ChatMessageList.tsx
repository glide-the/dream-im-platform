"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type FileUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ToolMessagePart } from "../ToolMessagePart";
import { FileMessagePart } from "../FileMessagePart";
import { AssistMessagePart } from "./AssistMessagePart";
import { type SessionResultData } from "./SessionResultCard";
import type { ChatMetadata } from "../../lib/chat-schema";

interface ChatMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error | null;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
  shouldShowLoadingIndicator?: boolean;
  /** Whether the view is read-only (disables destructive actions) */
  readonly?: boolean;
  /** Setter for updating the messages array */
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  /** Send message function (used for retry/regenerate) */
  sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
}

type ToolStatus = "executing" | "completed" | "error";

const TOOL_COMPLETED_STATES = new Set(["output-available", "output-error"]);
const REASONING_PREVIEW_LENGTH = 80;

export function getToolStatus(part: ToolUIPart | DynamicToolUIPart, isLoading: boolean, _isLast: boolean): ToolStatus {
  const state = part.state;
  if (state === "output-error") return "error";
  if (TOOL_COMPLETED_STATES.has(state ?? "")) return "completed";
  if (isLoading) return "executing";
  return "completed";
}

function getToolOutputText(part: ToolUIPart | DynamicToolUIPart): string | null {
  if ("output" in part && part.output != null) {
    return typeof part.output === "string" ? part.output : JSON.stringify(part.output, null, 2);
  }
  if ("error" in part && part.error != null) {
    return typeof part.error === "string" ? part.error : JSON.stringify(part.error, null, 2);
  }
  return null;
}

/**
 * Parse terminal output to extract command, output text, and exit code.
 */
function parseTerminalOutput(raw: string): { command: string | null; output: string; exitCode: string | null } {
  const lines = raw.split("\n");
  let command: string | null = null;
  let exitCode: string | null = null;
  const outputLines: string[] = [];

  for (const line of lines) {
    const cmdMatch = line.match(/^\$\s+(.+)/);
    const exitMatch = line.match(/^Exit code:\s*(\d+)/i);
    if (cmdMatch && !command) {
      command = cmdMatch[1];
    } else if (exitMatch) {
      exitCode = exitMatch[1];
    } else {
      outputLines.push(line);
    }
  }

  return { command, output: outputLines.join("\n").trim(), exitCode };
}

/** Copy icon SVG */
function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default function ChatMessageList({
  messages,
  isLoading,
  error,
  addToolResult,
  shouldShowLoadingIndicator = false,
  readonly = false,
  setMessages,
  sendMessage,
}: ChatMessageListProps) {
  const [expandedParts, setExpandedParts] = useState<Record<string, boolean>>({});
  const [copiedPartId, setCopiedPartId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPartId(id);
    window.setTimeout(() => {
      setCopiedPartId((current) => (current === id ? null : current));
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {messages.map((msg, index) => {
        const isLastMessage = index === messages.length - 1;

        const metadata = msg.metadata as ChatMetadata | undefined;
        const sessionResult = metadata?.unstable_data?.type === "session_result"
          ? (metadata.unstable_data as SessionResultData)
          : null;

        return (
          <div key={msg.id} className="space-y-4">
            {msg.parts?.map((part, partIndex) => {
              const partKey = `${msg.id}-${partIndex}`;
              const isExpanded = expandedParts[partKey] ?? false;
              const toggleExpanded = () =>
                setExpandedParts((prev) => ({
                  ...prev,
                  [partKey]: !isExpanded,
                }));

              {/* ── Reasoning (collapsible, subtle) ── */ }
              if (part.type === "reasoning") {
                const reasoningText = (part as { text?: string }).text ?? "";
                return (
                  <div key={partKey} className="border-l-2 border-accent-orange/40 pl-3">
                    <button
                      type="button"
                      onClick={toggleExpanded}
                      className="flex w-full items-center gap-2 text-sm italic text-text-tertiary hover:text-text-secondary"
                    >
                      <span className="flex-1 truncate text-left">{reasoningText.slice(0, REASONING_PREVIEW_LENGTH) || "思考中…"}</span>
                      <span className="shrink-0 text-xs">{isExpanded ? "‹" : "›"}</span>
                    </button>
                    {isExpanded && (
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                        {reasoningText}
                      </div>
                    )}
                  </div>
                );
              }

              {/* ── Step divider ── */ }
              if (part.type === "step-start") {
                return null; // Suppress step-start dividers for cleaner UI per PRD
              }

              {/* ── Text: user (right card) / assistant (plain text) ── */ }
              if (part.type === "text" && part.text) {
                const isUser = msg.role === "user";

                if (isUser) {
                  // User message: right-aligned light card
                  return (
                    <div key={partKey} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl bg-bg-surface px-4 py-3 shadow-subtle">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary [&_a]:text-accent-orange [&_a]:underline">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                        </p>
                      </div>
                    </div>
                  );
                }

                // Assistant text: left-aligned, with action bar
                {
                  const isLastPart = partIndex === (msg.parts?.length ?? 0) - 1;
                  const prevMsg = index > 0 ? messages[index - 1] : undefined;

                  return (
                    <div key={partKey} className="max-w-3xl">
                      <AssistMessagePart
                        part={part}
                        isLast={isLastMessage && isLastPart}
                        isLoading={isLoading}
                        message={msg}
                        prevMessage={prevMsg}
                        showActions={
                          isLastMessage ? isLastPart && !isLoading : isLastPart
                        }
                        readonly={readonly}
                        setMessages={setMessages}
                        sendMessage={sendMessage}
                        sessionResult={isLastPart ? sessionResult : undefined}
                      />
                    </div>
                  );
                }
              }

              {/* ── Tool: collapsible step OR terminal output ── */ }
              if (isToolUIPart(part)) {
                const toolPart = part as ToolUIPart | DynamicToolUIPart;
                const toolName = getToolName(toolPart);
                const toolStatus = getToolStatus(toolPart, isLoading, isLastMessage);
                const isCompleted = toolStatus !== "executing";
                const isError = toolStatus === "error";
                const outputText = getToolOutputText(toolPart);
                const title = "title" in toolPart ? (toolPart as { title?: string }).title : undefined;
                const displayTitle = title || toolName;

                // If completed with output → render as terminal code block
                if (isCompleted && outputText) {
                  const { command, output: termOutput, exitCode } = parseTerminalOutput(outputText);
                  const exitCodeNum = exitCode != null ? Number(exitCode) : null;

                  return (
                    <div key={partKey} className="group rounded-lg bg-[#1a1a1a] text-sm overflow-hidden">
                      {/* Terminal header */}
                      <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-400">
                        <span className="font-medium text-gray-500">‹ Terminal</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(partKey, outputText)}
                          className="p-1 rounded transition-colors hover:text-white"
                          title="复制"
                        >
                          {copiedPartId === partKey ? (
                            <span className="text-xs text-emerald-400">Copied!</span>
                          ) : (
                            <IconCopy className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {/* Terminal body */}
                      <div className="px-4 pb-3 font-mono text-[13px] leading-relaxed">
                        {command && (
                          <p className="mb-1">
                            <span className="text-accent-orange">$</span>{" "}
                            <span className="text-white">{command}</span>
                          </p>
                        )}
                        {termOutput && (
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-gray-400">{termOutput}</pre>
                        )}
                        {/* If no parsed command/output, show raw */}
                        {!command && !termOutput && (
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-gray-400">{outputText}</pre>
                        )}
                      </div>
                      {/* Exit code footer */}
                      {exitCodeNum != null && (
                        <div className="border-t border-white/10 px-4 py-2 font-mono text-xs text-gray-500">
                          Exit code:{" "}
                          <span className={exitCodeNum === 0 ? "text-emerald-400" : "text-red-400"}>
                            {exitCode}
                          </span>
                        </div>
                      )}
                      {isError && exitCodeNum == null && (
                        <div className="border-t border-white/10 px-4 py-2 font-mono text-xs text-red-400">
                          Error
                        </div>
                      )}
                    </div>
                  );
                }

                // Executing or no output → collapsible tool step with orange left border
                return (
                  <div key={partKey} className="border-l-2 border-accent-orange pl-3">
                    <button
                      type="button"
                      onClick={toggleExpanded}
                      className="flex w-full items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
                    >
                      {toolStatus === "executing" && (
                        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent-orange border-t-transparent" />
                      )}
                      <span className="flex-1 truncate text-left italic">{displayTitle}</span>
                      <span className="shrink-0 text-xs text-text-tertiary">{isExpanded ? "‹" : "›"}</span>
                    </button>
                    {isExpanded && (
                      <div className="mt-2 rounded-md bg-bg-secondary/60 p-2">
                        <ToolMessagePart
                          part={toolPart}
                          isLast={isLastMessage}
                          isLoading={isLoading}
                          isManualToolInvocation={false}
                          addToolResult={addToolResult}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              {/* ── File attachment ── */ }
              if (part.type === "file") {
                const isUser = msg.role === "user";
                return (
                  <div key={partKey} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[80%]">
                      <FileMessagePart part={part as FileUIPart} isUserMessage={isUser} />
                    </div>
                  </div>
                );
              }

              return null;
            })}
          </div>
        );
      })}

      {shouldShowLoadingIndicator && (
        <div className="flex justify-start" aria-live="polite">
          <div className="w-[220px] overflow-hidden rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-secondary">
            <div className="relative h-px w-full bg-gradient-to-r from-transparent via-accent-orange/20 to-transparent">
              <span className="animate-orange-progress absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-accent-orange to-transparent" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-danger-light px-3 py-2 text-sm text-danger">
            出错了：{error.message}
          </div>
        </div>
      )}
    </div>
  );
}
