"use client";

import { isToolUIPart, type DynamicToolUIPart, type FileUIPart, type ToolUIPart, type UIMessage } from "ai";
import { ToolMessagePart } from "../ToolMessagePart";
import { FileMessagePart } from "../FileMessagePart";

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
  return (
    <div className="space-y-4">
      {messages.map((msg, index) => {
        const isUser = msg.role === "user";
        const isLastMessage = index === messages.length - 1;

        return (
          <div key={msg.id} className="space-y-2">
            {msg.parts?.map((part, partIndex) => {
              const isLastPart = partIndex === (msg.parts?.length ?? 0) - 1;

              if (part.type === "step-start") {
                return (
                  <div key={`${msg.id}-${partIndex}`} className="flex justify-center py-1">
                    <div className="rounded-full bg-bg-secondary/60 px-2 py-0.5 text-xs text-text-tertiary">⎯ 新步骤 ⎯</div>
                  </div>
                );
              }

              if (part.type === "reasoning") {
                const reasoningText = (part as { text?: string }).text;
                if (!reasoningText) return null;
                return (
                  <div key={`${msg.id}-${partIndex}`} className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-tl-none border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-700">
                      {reasoningText}
                    </div>
                  </div>
                );
              }

              if (part.type === "text" && part.text) {
                return (
                  <div key={`${msg.id}-${partIndex}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={[
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                        isUser ? "rounded-tr-none bg-accent text-white" : "rounded-tl-none bg-bg-secondary text-text-secondary",
                      ].join(" ")}
                    >
                      {part.text}
                    </div>
                  </div>
                );
              }

              if (isToolUIPart(part)) {
                return (
                  <div key={`${msg.id}-${partIndex}`} className="flex justify-start">
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
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
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
          <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-red-100 px-3 py-2 text-sm text-red-600">出错了：{error.message}</div>
        </div>
      )}
    </div>
  );
}
