"use client";

import { useMemo } from "react";
import { isToolUIPart, type UIMessage, type ToolUIPart, type DynamicToolUIPart, type FileUIPart } from "ai";
import { ToolMessagePart } from "../ToolMessagePart";
import { FileMessagePart } from "../FileMessagePart";

interface ChatMessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error | null;
  addToolResult: (params: { tool: string; toolCallId: string; output: unknown }) => void;
  chatContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export default function ChatMessageList({
  messages,
  isLoading,
  error,
  addToolResult,
  chatContainerRef,
}: ChatMessageListProps) {
  const shouldShowLoadingIndicator = useMemo(() => {
    if (!isLoading || messages.length === 0) return false;
    const lastMessage = messages.at(-1);
    const hasVisibleParts = lastMessage?.parts?.some(
      (p) => p.type === "text" || isToolUIPart(p)
    );
    return !hasVisibleParts;
  }, [isLoading, messages]);

  return (
    <div
      ref={chatContainerRef}
      className="space-y-3 max-h-80 overflow-y-auto"
    >
      {messages.length === 0 ? (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-tl-none bg-bg-secondary px-3 py-2 text-sm text-text-secondary max-w-[80%]">
            你好！有什么我可以帮助你的吗？
          </div>
        </div>
      ) : (
        messages.map((msg, msgIndex) => {
          const isUser = msg.role === "user";
          const isLastMessage = msgIndex === messages.length - 1;
          return (
            <div key={msg.id} className="flex flex-col gap-2">
              {msg.parts?.map((part, partIndex) => {
                const isLastPart =
                  partIndex === (msg.parts?.length ?? 0) - 1;

                // Handle step-start parts
                if (part.type === "step-start") {
                  return (
                    <div
                      key={`${msg.id}-${partIndex}`}
                      className="flex justify-center my-1"
                      role="separator"
                      aria-label="新步骤开始"
                    >
                      <div
                        className="text-xs text-text-tertiary bg-bg-secondary/50 px-2 py-0.5 rounded-full"
                        aria-hidden="true"
                      >
                        ⎯ 新步骤 ⎯
                      </div>
                    </div>
                  );
                }

                // Handle reasoning parts
                if (part.type === "reasoning") {
                  const reasoningText = (part as { text?: string }).text;
                  if (!reasoningText) return null;
                  return (
                    <div
                      key={`${msg.id}-${partIndex}`}
                      className="flex justify-start"
                    >
                      <div className="rounded-2xl rounded-tl-none bg-purple-50 border border-purple-200 px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
                        <div
                          className="flex items-center gap-1.5 mb-1"
                          aria-label="AI 正在思考"
                        >
                          <span
                            className="text-purple-500 text-xs"
                            aria-hidden="true"
                          >
                            💭
                          </span>
                          <span className="text-purple-500 text-xs">
                            思考中
                          </span>
                        </div>
                        <div className="text-purple-700 text-sm">
                          {reasoningText}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Handle text parts
                if (part.type === "text" && part.text) {
                  return (
                    <div
                      key={`${msg.id}-${partIndex}`}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={[
                          "rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap",
                          isUser
                            ? "rounded-tr-none bg-accent text-white"
                            : "rounded-tl-none bg-bg-secondary text-text-secondary",
                        ].join(" ")}
                      >
                        {part.text}
                      </div>
                    </div>
                  );
                }

                // Handle tool parts
                if (isToolUIPart(part)) {
                  return (
                    <div
                      key={`${msg.id}-${partIndex}`}
                      className="flex justify-start"
                    >
                      <div className="max-w-[90%]">
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

                // Handle file parts
                if (part.type === "file") {
                  return (
                    <div
                      key={`${msg.id}-${partIndex}`}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div className="max-w-[80%]">
                        <FileMessagePart
                          part={part as FileUIPart}
                          isUserMessage={isUser}
                        />
                      </div>
                    </div>
                  );
                }

                // Skip other part types
                return null;
              })}
            </div>
          );
        })
      )}
      {shouldShowLoadingIndicator && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-tl-none bg-bg-secondary px-3 py-2 text-sm text-text-secondary max-w-[80%]">
            <span className="inline-flex gap-1">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse delay-75">●</span>
              <span className="animate-pulse delay-150">●</span>
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-tl-none bg-red-100 px-3 py-2 text-sm text-red-600 max-w-[80%]">
            出错了：{error.message}
          </div>
        </div>
      )}
    </div>
  );
}
