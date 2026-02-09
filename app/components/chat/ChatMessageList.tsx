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
import { ToolMessagePart } from "../ToolMessagePart";
import { FileMessagePart } from "../FileMessagePart";

interface ChatMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error | null;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
  shouldShowLoadingIndicator?: boolean;
}

type IdentityInfo = {
  icon: string;
  label: string;
};

type ToolStatus = "executing" | "completed" | "error";

const TOOL_COMPLETED_STATES = new Set(["output-available", "output-error"]);

function formatTime(date?: Date): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFullTime(date?: Date): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getIdentityInfo(role: UIMessage["role"], isToolMessage: boolean): IdentityInfo {
  if (isToolMessage) {
    return { icon: "🔧", label: "Plugin" };
  }
  if (role === "user") {
    return { icon: "👤", label: "User" };
  }
  return { icon: "🤖", label: "System" };
}

function getToolStatus(part: ToolUIPart | DynamicToolUIPart, isLoading: boolean, isLast: boolean): ToolStatus {
  const state = part.state;
  if (state === "output-error") return "error";
  if (TOOL_COMPLETED_STATES.has(state ?? "")) return "completed";
  if (isLast && isLoading) return "executing";
  return "executing";
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

function shouldCollapseText(text: string): boolean {
  return text.length > 140;
}

function highlightKeywords(text: string): string {
  return text.replace(/「([^」]+)」/g, "**$1**");
}

export default function ChatMessageList({
  messages,
  isLoading,
  error,
  addToolResult,
  shouldShowLoadingIndicator = false,
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
    <div className="space-y-6">
      {messages.map((msg, index) => {
        const isLastMessage = index === messages.length - 1;
        const createdAt = msg.createdAt ? new Date(msg.createdAt) : undefined;
        const timeLabel = formatTime(createdAt);
        const fullTimeLabel = formatFullTime(createdAt);

        const stepStartIndices = (msg.parts ?? [])
          .map((part, partIndex) => (part.type === "step-start" ? partIndex : null))
          .filter((partIndex): partIndex is number => partIndex !== null);
        const totalSteps = stepStartIndices.length;
        const stepIndexMap = new Map(stepStartIndices.map((partIndex, stepIndex) => [partIndex, stepIndex + 1]));

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

              if (part.type === "reasoning") {
                const reasoningText = (part as { text?: string }).text ?? "";
                const shouldClamp = shouldCollapseText(reasoningText);
                const highlighted = highlightKeywords(reasoningText);

                return (
                  <div key={partKey} className="flex justify-start">
                    <div className="group w-full max-w-2xl">
                      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="text-accent-orange">🧠</span>
                          <span className="font-semibold text-accent-orange">System</span>
                        </div>
                        {timeLabel && (
                          <span
                            className="cursor-pointer text-xs text-gray-400 transition-colors group-hover:text-accent-orange"
                            title={fullTimeLabel}
                          >
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      <div className="relative rounded-lg border border-border/60 bg-bg-secondary/40 p-3 text-sm text-text-primary">
                        <div
                          className={[
                            "leading-relaxed",
                            !isExpanded && shouldClamp ? "line-clamp-2" : "",
                          ].join(" ")}
                        >
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              strong: ({ children }) => (
                                <strong className="text-sky-400">{children}</strong>
                              ),
                            }}
                          >
                            {`我在想：${highlighted}`}
                          </ReactMarkdown>
                        </div>
                        {shouldClamp && (
                          <button
                            type="button"
                            onClick={toggleExpanded}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-accent-orange"
                          >
                            {isExpanded ? "收起" : "展开"}
                            <span aria-hidden="true">{isExpanded ? "▴" : "▾"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              if (part.type === "step-start") {
                const stepIndex = stepIndexMap.get(partIndex) ?? 1;

                return (
                  <div key={partKey} className="flex justify-start">
                    <div className="group w-full max-w-2xl">
                      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="text-accent-orange">📌</span>
                          <span className="font-semibold text-accent-orange">System</span>
                        </div>
                        {timeLabel && (
                          <span
                            className="cursor-pointer text-xs text-gray-400 transition-colors group-hover:text-accent-orange"
                            title={fullTimeLabel}
                          >
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      <div className="rounded-lg border border-border/60 bg-bg-secondary/40 p-3 text-sm text-text-primary">
                        <p className="leading-relaxed">
                          接下来要做：步骤推进 <span className="text-sky-400">【{stepIndex}/{totalSteps || 1}】</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

              if (part.type === "text" && part.text) {
                const isUser = msg.role === "user";
                const identity = getIdentityInfo(msg.role, false);
                const shouldClamp = shouldCollapseText(part.text);

                return (
                  <div key={partKey} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className="group w-full max-w-2xl">
                      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="text-accent-orange text-lg">{identity.icon}</span>
                          <span className="font-semibold text-accent-orange">{identity.label}</span>
                        </div>
                        {timeLabel && (
                          <span
                            className="cursor-pointer text-xs text-gray-400 transition-colors group-hover:text-accent-orange"
                            title={fullTimeLabel}
                          >
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      <div
                        className={[
                          "relative rounded-lg border border-border/60 bg-bg-surface px-4 py-3 text-sm text-text-primary",
                          isUser ? "bg-accent-orange text-white" : "bg-bg-secondary/40",
                        ].join(" ")}
                      >
                        {isUser ? (
                          <p className={"whitespace-pre-wrap leading-relaxed"}>{part.text}</p>
                        ) : (
                          <div
                            className={[
                              "prose prose-sm max-w-none font-body text-[14px] leading-[1.6] text-text-primary",
                              "[&_a]:text-accent-orange [&_a]:underline",
                              "[&_li::marker]:text-accent-orange",
                              "[&_strong]:text-sky-400 [&_strong]:font-semibold",
                              !isExpanded && shouldClamp ? "line-clamp-2" : "",
                            ].join(" ")}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                          </div>
                        )}
                        {shouldClamp && !isUser && (
                          <button
                            type="button"
                            onClick={toggleExpanded}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-accent-orange"
                          >
                            {isExpanded ? "收起" : "展开"}
                            <span aria-hidden="true">{isExpanded ? "▴" : "▾"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              if (isToolUIPart(part)) {
                const toolPart = part as ToolUIPart | DynamicToolUIPart;
                const toolName = getToolName(toolPart);
                const toolStatus = getToolStatus(toolPart, isLoading, isLastMessage);
                const isCompleted = toolStatus !== "executing";
                const isError = toolStatus === "error";
                const alignment = isCompleted ? "justify-end" : "justify-start";
                const outputText = getToolOutputText(toolPart);
                const canCopy = Boolean(outputText);
                const identity = getIdentityInfo(msg.role, true);

                return (
                  <div key={partKey} className={`flex ${alignment}`}>
                    <div className="group w-full max-w-2xl">
                      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="text-accent-orange text-lg">{identity.icon}</span>
                          <span className="font-semibold text-accent-orange">{identity.label}</span>
                        </div>
                        {timeLabel && (
                          <span
                            className="cursor-pointer text-xs text-gray-400 transition-colors group-hover:text-accent-orange"
                            title={fullTimeLabel}
                          >
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      <div
                        className={[
                          "relative rounded-lg border border-border/60 p-3 text-sm",
                          isCompleted ? "bg-black/70" : "bg-bg-secondary/50",
                          isError ? "text-red-400" : "text-emerald-300",
                        ].join(" ")}
                      >
                        <div className="mb-2 flex items-center justify-between text-xs text-text-secondary">
                          <div className="flex items-center gap-2 text-text-primary">
                            <span className="text-accent-orange">{isCompleted ? "💻" : "▶️"}</span>
                            <span className="font-semibold">
                              {isCompleted ? "终端结果" : "正在执行"}：{toolName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            {toolStatus === "executing" && (
                              <span className="flex items-center gap-1 text-accent-orange">
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent-orange border-t-transparent" />
                                执行中
                              </span>
                            )}
                            {toolStatus === "completed" && <span className="text-emerald-400">✅</span>}
                            {toolStatus === "error" && <span className="text-red-400">⚠️</span>}
                          </div>
                        </div>

                        {isCompleted && outputText ? (
                          <pre className="max-h-80 overflow-auto rounded-md bg-black/60 p-3 font-mono text-sm leading-relaxed text-inherit">
                            {outputText}
                          </pre>
                        ) : (
                          <div className="rounded-md bg-bg-surface/60 p-2">
                            <ToolMessagePart
                              part={toolPart}
                              isLast={isLastMessage}
                              isLoading={isLoading}
                              isManualToolInvocation={false}
                              addToolResult={addToolResult}
                            />
                          </div>
                        )}

                        {isCompleted && canCopy && (
                          <div className="mt-2 flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => handleCopy(partKey, outputText ?? "")}
                              className="text-xs text-gray-400 transition-colors hover:text-accent-orange"
                            >
                              📋 复制
                            </button>
                            {copiedPartId === partKey && (
                              <span className="rounded bg-emerald-500 px-2 py-0.5 text-xs text-white">Copied!</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              if (part.type === "file") {
                const isUser = msg.role === "user";
                const identity = getIdentityInfo(msg.role, false);

                return (
                  <div key={partKey} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className="group w-full max-w-2xl">
                      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="text-accent-orange text-lg">{identity.icon}</span>
                          <span className="font-semibold text-accent-orange">{identity.label}</span>
                        </div>
                        {timeLabel && (
                          <span
                            className="cursor-pointer text-xs text-gray-400 transition-colors group-hover:text-accent-orange"
                            title={fullTimeLabel}
                          >
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      <div className="max-w-[80%]">
                        <FileMessagePart part={part as FileUIPart} isUserMessage={isUser} />
                      </div>
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
