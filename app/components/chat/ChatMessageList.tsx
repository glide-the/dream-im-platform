"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isToolUIPart, type DynamicToolUIPart, type FileUIPart, type ToolUIPart, type UIMessage } from "ai";
import { ToolMessagePart } from "../ToolMessagePart";
import { FileMessagePart } from "../FileMessagePart";
import { getVisibleOperations, shouldShowExpandOperations, type OperationPart } from "./interaction-utils";

interface ChatMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error | null;
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void;
  shouldShowLoadingIndicator?: boolean;
}

export default function ChatMessageList({
  messages,
  isLoading,
  error,
  addToolResult,
  shouldShowLoadingIndicator = false,
}: ChatMessageListProps) {
  const [expandedOperations, setExpandedOperations] = useState<Record<string, boolean>>({});
  const [copiedPartId, setCopiedPartId] = useState<string | null>(null);

  const timestampFormatter = useMemo(() => {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }, []);

  const formatTimestamp = (date?: Date) => {
    if (!date) return "";
    return timestampFormatter.format(date).replaceAll("/", "-");
  };

  const getCodeBlockText = (text: string) => {
    const match = /```(?:\w+)?\n([\s\S]*?)```/m.exec(text);
    return match?.[1]?.trim() || text.trim();
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPartId(id);
      window.setTimeout(() => setCopiedPartId((current) => (current === id ? null : current)), 1500);
    } catch (copyError) {
      console.error("复制失败", copyError);
    }
  };

  return (
    <div className="space-y-4">
      {messages.map((msg, index) => {
        const isUser = msg.role === "user";
        const isLastMessage = index === messages.length - 1;

        const operations = (msg.parts ?? []).flatMap((part, partIndex) => {
          if (part.type === "step-start") {
            return [{ id: `${msg.id}-${partIndex}`, type: "step-start", text: "新步骤" } as OperationPart];
          }
          if (part.type === "reasoning") {
            const reasoningText = (part as { text?: string }).text;
            if (!reasoningText) return [];
            return [{ id: `${msg.id}-${partIndex}`, type: "reasoning", text: reasoningText } as OperationPart];
          }
          return [];
        });

        const isOperationsExpanded = !!expandedOperations[msg.id];
        const visibleOperations = getVisibleOperations(operations, isOperationsExpanded);

        return (
          <div key={msg.id} className="space-y-3">
            {operations.length > 0 && (
              <div className="space-y-3">
                {visibleOperations.map((op) => {
                  const operationIcon = op.type === "reasoning" ? "🧠" : "📌";

                  return (
                    <div
                      key={op.id}
                      className="flex items-start gap-3 animate-fadeUp"
                      style={{ animationDuration: "0.3s" }}
                    >
                      <div className="hidden h-7 w-7 items-center justify-center rounded-full bg-bg-secondary text-xs text-text-primary md:flex">
                        {operationIcon}
                      </div>
                      <div className="group relative w-[90%] rounded-2xl border border-border bg-bg-surface px-4 py-3 text-sm leading-[1.6] md:max-w-3xl">
                        <span className="absolute left-0 top-3 h-[calc(100%-1.5rem)] w-0.5 rounded-full bg-accent-orange" />
                        <div className="pr-8 text-text-primary">{op.text}</div>
                        <span className="absolute bottom-2 right-3 text-xs text-text-tertiary transition-colors group-hover:text-accent-orange md:right-3 md:bottom-2 md:text-[12px]">
                          {formatTimestamp(msg.createdAt)}
                        </span>
                        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-tertiary transition-colors group-hover:text-accent-orange md:hidden">
                          {formatTimestamp(msg.createdAt)}
                        </span>
                        <div className="pointer-events-none absolute inset-0 rounded-2xl transition duration-200 group-hover:brightness-[1.05] group-hover:shadow-[0_0_0_1px_var(--color-accent-orange)]" />
                      </div>
                    </div>
                  );
                })}

                {shouldShowExpandOperations(operations) && (
                  <button
                    type="button"
                    className="pl-10 text-xs text-accent-orange underline underline-offset-2"
                    onClick={() => setExpandedOperations((prev) => ({ ...prev, [msg.id]: !isOperationsExpanded }))}
                    aria-label={isOperationsExpanded ? "收起操作历史" : "展开更多操作历史"}
                  >
                    {isOperationsExpanded ? "收起" : "展开更多"}
                  </button>
                )}
              </div>
            )}

            {msg.parts?.map((part, partIndex) => {
              const isLastPart = partIndex === (msg.parts?.length ?? 0) - 1;

              if (part.type === "step-start" || part.type === "reasoning") {
                return null;
              }

              if (part.type === "text" && part.text) {
                const isTerminalContent = !isUser && part.text.includes("```");
                const copyTarget = isTerminalContent ? getCodeBlockText(part.text) : part.text;
                const timestamp = formatTimestamp(msg.createdAt);

                return (
                  <div
                    key={`${msg.id}-${partIndex}`}
                    className={`flex animate-fadeUp ${isUser ? "justify-end" : "justify-start"}`}
                    style={{ animationDuration: "0.3s" }}
                  >
                    {!isUser && isTerminalContent && (
                      <div className="hidden h-7 w-7 items-center justify-center rounded-full bg-accent-orange text-xs text-white md:flex">
                        💻
                      </div>
                    )}
                    <div
                      className={[
                        "group relative w-[90%] rounded-2xl px-4 py-3 text-sm leading-[1.6] md:max-w-3xl",
                        isUser
                          ? "bg-accent-orange text-white"
                          : isTerminalContent
                            ? "bg-bg-primary text-text-primary md:rounded-2xl md:border-r-2 md:border-accent-orange"
                            : "bg-bg-surface text-text-primary md:rounded-2xl md:border-l-2 md:border-accent-orange",
                      ].join(" ")}
                    >
                      {isTerminalContent && !isUser && (
                        <button
                          type="button"
                          className="absolute right-3 top-3 hidden rounded-full border border-transparent p-1 text-xs text-text-tertiary transition group-hover:flex hover:text-accent-orange"
                          onClick={() => handleCopy(`${msg.id}-${partIndex}`, copyTarget)}
                          aria-label="复制终端内容"
                        >
                          📋
                        </button>
                      )}
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{part.text}</p>
                      ) : (
                        <div className="prose prose-sm max-w-none font-body text-[14px] leading-[1.6] [&_a]:text-accent-orange [&_a]:underline [&_li::marker]:text-accent-orange [&_strong]:text-accent-orange [&_strong]:font-semibold">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                        </div>
                      )}
                      {isTerminalContent && copiedPartId === `${msg.id}-${partIndex}` && (
                        <span className="absolute right-10 top-3 rounded-full bg-accent-orange/20 px-2 py-0.5 text-[11px] text-accent-orange">
                          已复制
                        </span>
                      )}
                      {timestamp && (
                        <>
                          <span className="absolute bottom-2 right-3 text-xs text-text-tertiary transition-colors group-hover:text-accent-orange md:right-3 md:bottom-2 md:text-[12px]">
                            {timestamp}
                          </span>
                          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-tertiary transition-colors group-hover:text-accent-orange md:hidden">
                            {timestamp}
                          </span>
                        </>
                      )}
                      <div className="pointer-events-none absolute inset-0 rounded-2xl transition duration-200 group-hover:brightness-[1.05] group-hover:shadow-[0_0_0_1px_var(--color-accent-orange)]" />
                    </div>
                  </div>
                );
              }

              if (isToolUIPart(part)) {
                const toolState = (part as { state?: string }).state;
                const isExecuting = isLastMessage && isLastPart && isLoading && toolState !== "output-available" && toolState !== "output-error";
                const timestamp = formatTimestamp(msg.createdAt);

                return (
                  <div
                    key={`${msg.id}-${partIndex}`}
                    className="flex animate-fadeUp items-start gap-3 justify-start"
                    style={{ animationDuration: "0.3s" }}
                  >
                    <div className="hidden h-7 w-7 items-center justify-center rounded-full bg-bg-secondary text-xs text-text-primary md:flex">
                      ▶️
                    </div>
                    <div className="group relative w-[90%] rounded-2xl border border-border bg-bg-surface p-2 md:max-w-[90%] md:border-l-2 md:border-accent-orange">
                      <span className="absolute -left-[2px] top-3 h-[calc(100%-1.5rem)] w-0.5 rounded-full bg-accent-orange" />
                      <ToolMessagePart
                        part={part as ToolUIPart | DynamicToolUIPart}
                        isLast={isLastMessage && isLastPart}
                        isLoading={isLoading}
                        isManualToolInvocation={false}
                        addToolResult={addToolResult}
                      />
                      <div className="absolute right-3 top-3 flex items-center gap-1 text-xs text-text-tertiary">
                        {isExecuting ? (
                          <>
                            <span className="h-2 w-2 rounded-full bg-accent-orange shadow-[0_0_8px_var(--color-accent-orange)] animate-orange-breath" />
                            <span className="hidden md:inline">执行中</span>
                          </>
                        ) : (
                          <span className="text-success">✅</span>
                        )}
                      </div>
                      {timestamp && (
                        <>
                          <span className="absolute bottom-2 right-3 text-xs text-text-tertiary transition-colors group-hover:text-accent-orange md:right-3 md:bottom-2 md:text-[12px]">
                            {timestamp}
                          </span>
                          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-tertiary transition-colors group-hover:text-accent-orange md:hidden">
                            {timestamp}
                          </span>
                        </>
                      )}
                      <div className="pointer-events-none absolute inset-0 rounded-2xl transition duration-200 group-hover:brightness-[1.05] group-hover:shadow-[0_0_0_1px_var(--color-accent-orange)]" />
                    </div>
                  </div>
                );
              }

              if (part.type === "file") {
                return (
                  <div
                    key={`${msg.id}-${partIndex}`}
                    className={`flex animate-fadeUp ${isUser ? "justify-end" : "justify-start"}`}
                    style={{ animationDuration: "0.3s" }}
                  >
                    <div className="w-[90%] md:max-w-[80%]">
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
          <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-danger-light px-3 py-2 text-sm text-danger">出错了：{error.message}</div>
        </div>
      )}
    </div>
  );
}
