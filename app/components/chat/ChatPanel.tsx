"use client";

import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type UIMessage,
  type FileUIPart,
  type TextUIPart,
} from "ai";
import AIInputDock, {
  type Attachment,
  type ToolChoice,
  type ContextCustomer,
  toAttachment,
} from "../AIInputDock";
import ChatMessageList from "./ChatMessageList";
import { useConversationByCustomer } from "../../lib/queries";
import type { ConversationMessage } from "../../lib/types";
import {
  type ChatApiSchemaRequestBody,
  type ChatAttachment,
  DEFAULT_CHAT_MODEL,
} from "../../lib/chat-schema";

export interface ChatPanelProps {
  threadId: string;
  contextCustomerId?: string;
  contextCustomers: ContextCustomer[];
  initialMessages?: ConversationMessage[];
  isLoading?: boolean;
  className?: string;
  inputPlaceholder?: string;
  /** Callback when chat area becomes active (first message sent) */
  onChatActive?: () => void;
}

export default function ChatPanel({
  threadId,
  contextCustomerId,
  contextCustomers,
  isLoading: externalLoading,
  className,
  inputPlaceholder = "继续提问或补充信息...",
  onChatActive,
}: ChatPanelProps) {
  const [toast, setToast] = useState<string | null>(null);

  // Store attachments and context for the current message being sent
  const pendingMessageDataRef = useRef<{
    rawAttachments: Attachment[];
    contextCustomerIds: string[];
    toolChoice: ToolChoice;
  } | null>(null);

  // Track current toolChoice for manual confirmation UI
  const currentToolChoiceRef = useRef<ToolChoice>("auto");

  // Chat scroll reference
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Generate a unique ID for messages
  const generateId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  // Fetch existing conversation for this customer
  const { data: conversationData, isLoading: isConversationLoading } =
    useConversationByCustomer(contextCustomerId ?? threadId);

  // useChat hook for AI conversation with ChatApiSchemaRequestBody protocol
  const {
    messages: chatMessages,
    sendMessage,
    setMessages,
    status,
    error: chatError,
    addToolResult,
  } = useChat({
    id: threadId,
    transport: new DefaultChatTransport({
      api: "/api/claude-agent",
      prepareSendMessagesRequest: ({ messages, body, id: chatId }) => {
        const lastMessage = messages.at(-1) as UIMessage | undefined;
        if (!lastMessage) {
          return { body };
        }

        // Get pending message data (attachments, customerIds, toolChoice)
        const pendingData = pendingMessageDataRef.current;
        const rawAttachments = pendingData?.rawAttachments ?? [];
        const contextCustomerIds =
          pendingData?.contextCustomerIds ??
          (contextCustomerId ? [contextCustomerId] : []);
        const toolChoice =
          pendingData?.toolChoice ?? currentToolChoiceRef.current;

        // Map AIInputDock attachments to ChatAttachment format for the API
        const attachments: ChatAttachment[] = rawAttachments
          .filter((file) => file.url)
          .map((file) => ({
            type: "file" as const,
            url: file.url!,
            mediaType: file.type,
            filename: file.name,
          }));

        // Build the ChatApiSchemaRequestBody
        const requestBody: ChatApiSchemaRequestBody = {
          id: chatId,
          message: lastMessage,
          chatModel: DEFAULT_CHAT_MODEL,
          toolChoice,
          allowedAppDefaultToolkit: [],
          allowedMcpServers: {},
          attachments,
          contextCustomerIds,
        };

        // Clear pending data after building request
        pendingMessageDataRef.current = null;

        return { body: requestBody };
      },
    }),
    generateId,
    experimental_throttle: 100,
    onError: (error) => {
      console.error("Chat error:", error);
      setToast(error.message || "对话出错");
    },
  });

  // Initialize chat messages from existing conversation
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (
      conversationData?.data &&
      !hasInitializedRef.current &&
      !isConversationLoading
    ) {
      const existingMessages = conversationData.data.messages;
      if (existingMessages && existingMessages.length > 0) {
        const uiMessages: UIMessage[] = existingMessages.map(
          (msg: ConversationMessage) => {
            const processedParts: Array<{
              type: string;
              [key: string]: unknown;
            }> = [];

            if (msg.parts && msg.parts.length > 0) {
              let currentTextPart: {
                type: "text";
                text: string;
                id?: string;
              } | null = null;

              for (const part of msg.parts) {
                if (part.type === "text-start") {
                  const startPart = part as { id?: string };
                  currentTextPart = {
                    type: "text",
                    text: "",
                    id: startPart.id,
                  };
                  continue;
                }

                if (part.type === "text-delta") {
                  const deltaPart = part as { id?: string; delta?: string };
                  if (currentTextPart) {
                    currentTextPart.text += deltaPart.delta || "";
                  } else {
                    currentTextPart = {
                      type: "text",
                      text: deltaPart.delta || "",
                      id: deltaPart.id,
                    };
                  }
                  continue;
                }

                if (part.type === "text-end") {
                  if (currentTextPart && currentTextPart.text.trim()) {
                    processedParts.push(currentTextPart);
                  }
                  currentTextPart = null;
                  continue;
                }

                if (currentTextPart && currentTextPart.text.trim()) {
                  processedParts.push(currentTextPart);
                  currentTextPart = null;
                }

                if (part.type === "reasoning-start") {
                  continue;
                }

                if (part.type === "reasoning-delta") {
                  const deltaPart = part as { id?: string; delta?: string };
                  if (deltaPart.delta) {
                    processedParts.push({
                      type: "reasoning",
                      text: deltaPart.delta,
                    });
                  }
                  continue;
                }

                if (part.type === "reasoning-end") {
                  continue;
                }

                if (part.type === "tool-input-start") {
                  const toolPart = part as {
                    toolCallId?: string;
                    toolName?: string;
                    input?: Record<string, unknown>;
                    title?: string;
                    providerExecuted?: boolean;
                  };
                  processedParts.push({
                    type: `tool-${toolPart.toolName || "unknown"}`,
                    toolCallId: toolPart.toolCallId || "",
                    toolName: toolPart.toolName || "",
                    input: toolPart.input || {},
                    state: "input-streaming",
                    title: toolPart.title,
                    providerExecuted: toolPart.providerExecuted,
                  });
                  continue;
                }

                if (part.type === "tool-input-available") {
                  const toolPart = part as {
                    toolCallId?: string;
                    toolName?: string;
                    input?: Record<string, unknown>;
                    title?: string;
                    providerExecuted?: boolean;
                  };
                  processedParts.push({
                    type: `tool-${toolPart.toolName || "unknown"}`,
                    toolCallId: toolPart.toolCallId || "",
                    toolName: toolPart.toolName || "",
                    input: toolPart.input || {},
                    state: "input-available",
                    title: toolPart.title,
                    providerExecuted: toolPart.providerExecuted,
                  });
                  continue;
                }

                if (part.type === "tool-output-available") {
                  const toolPart = part as {
                    toolCallId?: string;
                    toolName?: string;
                    input?: Record<string, unknown>;
                    output?: unknown;
                    title?: string;
                    providerExecuted?: boolean;
                  };
                  processedParts.push({
                    type: `tool-${toolPart.toolName || "unknown"}`,
                    toolCallId: toolPart.toolCallId || "",
                    toolName: toolPart.toolName || "",
                    input: toolPart.input || {},
                    output: toolPart.output,
                    state: "output-available",
                    title: toolPart.title,
                    providerExecuted: toolPart.providerExecuted,
                  });
                  continue;
                }

                if (part.type === "text") {
                  processedParts.push({
                    type: "text" as const,
                    text: (part as { text: string }).text || "",
                  });
                  continue;
                }

                if (part.type === "reasoning") {
                  processedParts.push({
                    type: "reasoning" as const,
                    text: (part as { text: string }).text || "",
                  });
                  continue;
                }

                if (part.type === "step-start") {
                  processedParts.push({ type: "step-start" });
                  continue;
                }

                if (
                  part.type.startsWith("tool-") ||
                  part.type === "dynamic-tool" ||
                  part.type === "tool"
                ) {
                  const toolPart = part as {
                    type: string;
                    toolCallId: string;
                    toolName: string;
                    input: Record<string, unknown>;
                    output?: unknown;
                    state: string;
                    title?: string;
                    providerExecuted?: boolean;
                  };
                  const displayState =
                    toolPart.state === "done"
                      ? "output-available"
                      : toolPart.state;
                  const displayType =
                    part.type === "tool" ? "dynamic-tool" : part.type;

                  processedParts.push({
                    type: displayType,
                    toolCallId: toolPart.toolCallId,
                    toolName: toolPart.toolName,
                    input: toolPart.input,
                    output: toolPart.output,
                    state: displayState,
                    title: toolPart.title,
                    providerExecuted: toolPart.providerExecuted,
                  });
                  continue;
                }

                if (part.type === "file") {
                  const filePart = part as {
                    url: string;
                    mediaType?: string;
                    filename?: string;
                  };
                  processedParts.push({
                    type: "file" as const,
                    url: filePart.url,
                    mediaType: filePart.mediaType,
                    filename: filePart.filename,
                  });
                  continue;
                }

                if (part.type === "source-url") {
                  const sourceUrlPart = part as {
                    url: string;
                    mediaType?: string;
                    title?: string;
                  };
                  processedParts.push({
                    type: "source-url" as const,
                    url: sourceUrlPart.url,
                    mediaType: sourceUrlPart.mediaType,
                    title: sourceUrlPart.title,
                  });
                  continue;
                }

                if (part.type === "finish" || part.type === "error") {
                  continue;
                }

                processedParts.push(part);
              }

              if (currentTextPart && currentTextPart.text.trim()) {
                processedParts.push(currentTextPart);
              }
            }

            return {
              id: msg.id,
              role: msg.role,
              parts:
                processedParts.length > 0
                  ? processedParts
                  : [{ type: "text" as const, text: msg.content }],
              createdAt: new Date(msg.created_at),
            };
          }
        );
        setMessages(uiMessages);
        hasInitializedRef.current = true;
      }
    }
  }, [conversationData, isConversationLoading, setMessages]);

  const chatLoading = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current && chatMessages.length > 0) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendMessage = async (
    message: string,
    uploadedFiles: Parameters<
      NonNullable<React.ComponentProps<typeof AIInputDock>["onSendMessage"]>
    >[1] = [],
    customerIds: string[] = [],
    toolChoice: ToolChoice = "auto"
  ) => {
    onChatActive?.();

    // Update current toolChoice ref
    currentToolChoiceRef.current = toolChoice;

    // Convert UploadedFile[] to Attachment[]
    const attachments = uploadedFiles.map(toAttachment);

    // Filter to only include files with valid URLs
    const validFiles = uploadedFiles.filter((f) => f.url);

    // Store attachments, customer IDs, and toolChoice
    pendingMessageDataRef.current = {
      rawAttachments: attachments,
      contextCustomerIds:
        customerIds.length > 0
          ? customerIds
          : contextCustomerId
            ? [contextCustomerId]
            : [],
      toolChoice,
    };

    // Build message parts: file parts first, then text
    const parts: Array<FileUIPart | TextUIPart> = [];

    for (const file of validFiles) {
      parts.push({
        type: "file",
        url: file.url!,
        mediaType: file.mimeType,
        filename: file.name,
      } as FileUIPart);
    }

    parts.push({
      type: "text",
      text: message,
    } as TextUIPart);

    await sendMessage({
      role: "user",
      parts,
    });
  };

  return (
    <div className={className}>
      {/* Chat Messages */}
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <p className="mb-3 text-xs font-semibold text-text-tertiary">
          与 AI 的对话
        </p>
        <ChatMessageList
          messages={chatMessages}
          isLoading={chatLoading}
          error={chatError ?? undefined}
          addToolResult={addToolResult}
          chatContainerRef={chatContainerRef}
        />
      </div>

      {/* AI Input Dock */}
      <div className="mt-4">
        <AIInputDock
          contextCustomerId={contextCustomerId}
          contextCustomers={contextCustomers}
          onSendMessage={handleSendMessage}
          onAddContextCustomer={() => {}}
          onRemoveContextCustomer={() => {}}
          placeholder={inputPlaceholder}
          loading={chatLoading || externalLoading}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-red-100 px-4 py-2 text-sm text-red-600 shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}
