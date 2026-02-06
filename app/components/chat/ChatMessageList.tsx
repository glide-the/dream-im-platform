"use client";

import { useState } from "react";
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
          <div key={msg.id} className="space-y-2">
            {operations.length > 0 && (
              <div className="space-y-1 rounded-lg border border-border/60 bg-bg-secondary/40 p-2">
                {visibleOperations.map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    className="flex w-full items-start gap-2 text-left text-xs text-text-secondary"
                    onClick={() => setExpandedOperations((prev) => ({ ...prev, [msg.id]: !isOperationsExpanded }))}
                    aria-label="展开或折叠历史操作"
                  >
                    <span className="mt-0.5 h-4 w-0.5 bg-accent-orange" aria-hidden="true" />
                    <span className="flex-1">{op.text}</span>
                    <span className="text-accent-orange">{isOperationsExpanded ? "▾" : "▸"}</span>
                  </button>
                ))}

                {shouldShowExpandOperations(operations) && (
                  <button
                    type="button"
                    className="pl-3 text-xs text-accent-orange underline"
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
                return (
                  <div key={`${msg.id}-${partIndex}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={[
                        "max-w-3xl rounded-2xl px-4 py-3 text-sm leading-[1.6]",
                        isUser
                          ? "bg-accent-orange text-white"
                          : "rounded-tl-none bg-[#F5F5F5] text-text-secondary",
                      ].join(" ")}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{part.text}</p>
                      ) : (
                        <div className="prose prose-sm max-w-none font-body text-[14px] leading-[1.6] [&_a]:text-accent-orange [&_a]:underline [&_li::marker]:text-accent-orange [&_strong]:text-accent-orange [&_strong]:font-semibold">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              if (isToolUIPart(part)) {
                return (
                  <div key={`${msg.id}-${partIndex}`} className="flex justify-start">
                    <div className="max-w-[90%] rounded-lg bg-[#F5F5F5] p-2 shadow-subtle transition duration-200 hover:-translate-y-[3px] hover:shadow-medium">
                      <ToolMessagePart
                        part={part as ToolUIPart | DynamicToolUIPart}
                        isLast={isLastMessage && isLastPart}
                        isLoading={isLoading}
                        isManualToolInvocation={false}
                        addToolResult={addToolResult}
                      />
                    </div>
                  </div>
                );
              }

              if (part.type === "file") {
                return (
                  <div key={`${msg.id}-${partIndex}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
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
          <div className="w-[220px] overflow-hidden rounded-lg bg-[#F5F5F5] px-3 py-2 text-sm text-text-secondary">
            <div className="relative h-px w-full bg-gradient-to-r from-transparent via-accent-orange/20 to-transparent">
              <span className="animate-orange-progress absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-accent-orange to-transparent" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-red-100 px-3 py-2 text-sm text-red-600">出错了：{error.message}</div>
        </div>
      )}
    </div>
  );
}
