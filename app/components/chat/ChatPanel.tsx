"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type FileUIPart, type TextUIPart, type UIMessage } from "ai";
import AIInputDock, { type Attachment, type ContextCustomer, type ToolChoice, toAttachment } from "../AIInputDock";
import { type ChatApiSchemaRequestBody, type ChatAttachment, DEFAULT_CHAT_MODEL } from "../../lib/chat-schema";
import { useConversationByCustomer } from "../../lib/queries";
import type { ConversationMessage } from "../../lib/types";
import ChatMessageList from "./ChatMessageList";
import { useWorkspaceSession } from "../../app/workspace-context";

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
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const hasInitializedRef = useRef(false);
  const lastQueuedNonceRef = useRef<number | undefined>(undefined);
  const { setActiveSessionId } = useWorkspaceSession();

  const { data: conversationData, isLoading: isConversationLoading } = useConversationByCustomer(contextCustomerId ?? threadId);

  /* eslint-disable react-hooks/refs */
  const { messages, sendMessage, setMessages, status, error, addToolResult, stop } = useChat({
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
    setActiveSessionId(threadId);
    return () => {
      setActiveSessionId((current) => (current === threadId ? null : current));
    };
  }, [threadId, setActiveSessionId]);

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

  // Track whether user is near the bottom of the chat scroll area
  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Auto-scroll to bottom when new messages arrive or during streaming,
  // but only if the user hasn't intentionally scrolled up
  useEffect(() => {
    if (isNearBottomRef.current) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [messages, status]);

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div ref={chatContainerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-bg-surface p-4">
        <ChatMessageList messages={messages} isLoading={chatLoading} error={error} addToolResult={addToolResult} shouldShowLoadingIndicator={shouldShowLoadingIndicator} />
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <div className="sticky bottom-0 mx-auto mt-3 w-full max-w-3xl">
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
          placeholder={inputPlaceholder}
          loading={chatLoading}
          onStop={status === "streaming" ? stop : undefined}
        />
      </div>
    </div>
  );
}
