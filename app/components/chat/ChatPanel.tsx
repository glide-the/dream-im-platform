"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type FileUIPart, type TextUIPart, type UIMessage } from "ai";
import AIInputDock, { type Attachment, type ContextCustomer, type ToolChoice, toAttachment } from "../AIInputDock";
import { type ChatApiSchemaRequestBody, type ChatAttachment, DEFAULT_CHAT_MODEL } from "../../lib/chat-schema";
import { useConversationByCustomer } from "../../lib/queries";
import type { ConversationMessage } from "../../lib/types";
import ChatMessageList from "./ChatMessageList";
import WorkspaceFileManager from "./WorkspaceFileManager";

interface ChatPanelProps {
  threadId: string;
  contextCustomerId?: string;
  contextCustomers: ContextCustomer[];
  initialMessages?: ConversationMessage[];
  isLoading?: boolean;
  className?: string;
  inputPlaceholder?: string;
  queuedPrompt?: string;
  queuedPromptNonce?: number;
  openFileDialogSignal?: number;
}

function mapConversationToUiMessages(conversationMessages: ConversationMessage[]): UIMessage[] {
  return conversationMessages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    parts: msg.parts as UIMessage["parts"],
    createdAt: new Date(msg.created_at),
  }));
}

export default function ChatPanel({
  threadId,
  contextCustomerId,
  contextCustomers,
  initialMessages,
  isLoading = false,
  className,
  inputPlaceholder = "Press i chat",
  queuedPrompt,
  queuedPromptNonce,
  openFileDialogSignal,
}: ChatPanelProps) {
  const pendingDataRef = useRef<{
    rawAttachments: Attachment[];
    contextCustomerIds: string[];
    toolChoice: ToolChoice;
  } | null>(null);
  const getPendingData = () => pendingDataRef.current;
  const [currentToolChoice, setCurrentToolChoice] = useState<ToolChoice>("auto");
  const [mobileTab, setMobileTab] = useState<"chat" | "files">("chat");
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const lastQueuedNonceRef = useRef<number | undefined>(undefined);

  const { data: conversationData, isLoading: isConversationLoading } = useConversationByCustomer(contextCustomerId ?? threadId);

  /* eslint-disable react-hooks/refs */
  const { messages, sendMessage, setMessages, status, error, addToolResult } = useChat({
    id: threadId,
    transport: new DefaultChatTransport({
      api: "/api/claude-agent",
      prepareSendMessagesRequest: ({ messages: outgoingMessages, body, id }) => {
        const lastMessage = outgoingMessages.at(-1) as UIMessage | undefined;
        if (!lastMessage) return { body };

        const attachments: ChatAttachment[] = (getPendingData()?.rawAttachments ?? []).filter((file) => file.url).map((file) => ({
          type: "file",
          url: file.url!,
          mediaType: file.type,
          filename: file.name,
        }));

        const requestBody: ChatApiSchemaRequestBody = {
          id,
          message: lastMessage,
          chatModel: DEFAULT_CHAT_MODEL,
          toolChoice: getPendingData()?.toolChoice ?? currentToolChoice,
          allowedAppDefaultToolkit: [],
          allowedMcpServers: {},
          attachments,
          contextCustomerIds: getPendingData()?.contextCustomerIds ?? (contextCustomerId ? [contextCustomerId] : contextCustomers.map((c) => c.id)),
        };

        setTimeout(() => { pendingDataRef.current = null; }, 0);
        return { body: requestBody };
      },
    }),
    generateId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    experimental_throttle: 100,
  });
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (hasInitializedRef.current) return;
    const baseMessages = initialMessages ?? conversationData?.data?.messages;
    if ((baseMessages?.length ?? 0) > 0) {
      setMessages(mapConversationToUiMessages(baseMessages ?? []));
      hasInitializedRef.current = true;
    }
  }, [conversationData?.data?.messages, initialMessages, setMessages]);

  useEffect(() => {
    if (!queuedPromptNonce || queuedPromptNonce === lastQueuedNonceRef.current) return;
    if (!queuedPrompt?.trim()) return;
    lastQueuedNonceRef.current = queuedPromptNonce;

    void (async () => {
      setCurrentToolChoice("auto");
      pendingDataRef.current = {
        rawAttachments: [],
        contextCustomerIds: contextCustomerId ? [contextCustomerId] : contextCustomers.map((c) => c.id),
        toolChoice: "auto",
      };
      await sendMessage({ role: "user", parts: [{ type: "text", text: queuedPrompt } as TextUIPart] });
    })();
  }, [contextCustomerId, contextCustomers, queuedPrompt, queuedPromptNonce, sendMessage]);

  const chatLoading = status === "streaming" || status === "submitted" || isLoading || isConversationLoading;

  const shouldShowLoadingIndicator = useMemo(() => {
    if (!chatLoading || messages.length === 0) return false;
    const lastMessage = messages.at(-1);
    const hasVisibleParts = lastMessage?.parts?.some((p) => p.type === "text" || isToolUIPart(p));
    return !hasVisibleParts;
  }, [chatLoading, messages]);

  useEffect(() => {
    if (chatContainerRef.current) chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-4 pb-16 md:flex-row md:pb-0 ${className ?? ""}`}>
      <div className={`flex min-h-0 flex-1 flex-col ${mobileTab === "chat" ? "flex" : "hidden md:flex"}`}>
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto rounded-2xl border border-border bg-surface p-4">
          <ChatMessageList messages={messages} isLoading={chatLoading} error={error} addToolResult={addToolResult} shouldShowLoadingIndicator={shouldShowLoadingIndicator} />
        </div>

        <div className="sticky bottom-0 mx-auto mt-3 w-full max-w-3xl rounded-2xl border border-[var(--neutral-border)] bg-white/80 p-5 shadow-sm backdrop-blur-md transition-all duration-300 hover:shadow-md">
          <AIInputDock
            contextCustomerId={contextCustomerId}
            contextCustomers={contextCustomers}
            openFileDialogSignal={openFileDialogSignal}
            onSendMessage={async (message, uploadedFiles = [], customerIds = [], toolChoice = "auto") => {
              setCurrentToolChoice(toolChoice);
              pendingDataRef.current = {
                rawAttachments: uploadedFiles.map(toAttachment),
                contextCustomerIds: customerIds.length > 0 ? customerIds : contextCustomers.map((c) => c.id),
                toolChoice,
              };

              const validFiles = uploadedFiles.filter((f) => f.url);
              const parts: Array<FileUIPart | TextUIPart> = validFiles.map((file) => ({
                type: "file",
                url: file.url!,
                mediaType: file.mimeType,
                filename: file.name,
              } as FileUIPart));
              parts.push({ type: "text", text: message } as TextUIPart);
              await sendMessage({ role: "user", parts });
            }}
            onAddContextCustomer={() => undefined}
            onRemoveContextCustomer={() => undefined}
            placeholder={inputPlaceholder}
            loading={chatLoading}
          />
        </div>
      </div>

      <div className={`${mobileTab === "files" ? "flex" : "hidden md:flex"} min-h-0 md:sticky md:top-6 md:h-[calc(100vh-6rem)]`}>
        <WorkspaceFileManager conversationId={threadId} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around gap-2 border-t border-border bg-white/90 p-2 text-xs text-text-secondary md:hidden">
        <button
          type="button"
          className={`flex-1 rounded-full px-3 py-2 font-semibold ${mobileTab === "chat" ? "bg-accent-orange text-white" : "bg-white"}`}
          onClick={() => setMobileTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={`flex-1 rounded-full px-3 py-2 font-semibold ${mobileTab === "files" ? "bg-accent-orange text-white" : "bg-white"}`}
          onClick={() => setMobileTab("files")}
        >
          Files
        </button>
      </div>
    </div>
  );
}
