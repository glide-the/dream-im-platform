"use client";

import { useState, useEffect, use, useMemo, useRef } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage, type ToolUIPart, type DynamicToolUIPart } from "ai";
import { IconChevronLeft, IconChevronDown } from "../../../components/Icons";
import Toast from "../../../components/Toast";
import ProfileCard from "../../../components/customer-detail/ProfileCard";
import BasicInfoSection from "../../../components/customer-detail/BasicInfoSection";
import MarkdownDetailSection from "../../../components/customer-detail/MarkdownDetailSection";
import DecisionChainSection from "../../../components/customer-detail/DecisionChainSection";
import AIInputDock, { type Attachment } from "../../../components/AIInputDock";
import { ToolMessagePart, isManualToolInvocationPart } from "../../../components/ToolMessagePart";
import { useCustomer, useUpdateCustomer, useConversationByCustomer } from "../../../lib/queries";
import type { DecisionChainItem, ConversationMessage } from "../../../lib/types";
import {
  type ChatApiSchemaRequestBody,
  type ChatAttachment,
  type ChatMetadata,
  DEFAULT_CHAT_MODEL,
} from "../../../lib/chat-schema";

type Customer = {
  id: string;
  name?: string;
  company?: string;
  title?: string;
  phones?: string[];
  emails?: string[];
  wechat?: string;
  address?: string;
  tags?: string[];
  decision_chain?: DecisionChainItem[];
  profile_markdown?: string;
  updated_at: string;
};

const emptyForm = {
  name: "",
  company: "",
  title: "",
  phones: "",
  emails: "",
  wechat: "",
  address: "",
  tags: "",
  decision_chain: [] as DecisionChainItem[],
  profile_markdown: ""
};

export default function CustomerDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [form, setForm] = useState({ ...emptyForm });
  const [toast, setToast] = useState<string | null>(null);

  // 卡片级独立编辑状态
  const [editingCard, setEditingCard] = useState<"profileCard" | "basicSection" | "detailSection" | null>(null);

  // 卡片折叠状态
  const [collapsedCards, setCollapsedCards] = useState<Set<"basicSection" | "detailSection">>(new Set());

  // 对话历史和折叠控制
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);
  const [showChatArea, setShowChatArea] = useState(false);

  // Store attachments and context for the current message being sent
  const pendingMessageDataRef = useRef<{
    rawAttachments: Attachment[];
    contextCustomerIds: string[];
  } | null>(null);

  // Chat scroll reference
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Generate a unique ID for messages
  const generateId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  // Thread ID = customer ID (one thread per customer)
  const threadId = id;

  // Fetch existing conversation for this customer
  const { data: conversationData, isLoading: isConversationLoading } = useConversationByCustomer(id);

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

        // Get pending message data (attachments, customerIds)
        const pendingData = pendingMessageDataRef.current;
        const rawAttachments = pendingData?.rawAttachments ?? [];
        const contextCustomerIds = pendingData?.contextCustomerIds ?? [id];

        // Map AIInputDock attachments to ChatAttachment format
        const attachments: ChatAttachment[] = rawAttachments.map((file) => ({
          type: "file" as const,
          url: file.name, // For now, just use filename as URL placeholder
          mediaType: file.type,
          filename: file.name,
        }));

        // Build the ChatApiSchemaRequestBody
        const requestBody: ChatApiSchemaRequestBody = {
          id: chatId,
          message: lastMessage,
          chatModel: DEFAULT_CHAT_MODEL,
          toolChoice: "auto",
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
    if (conversationData?.data && !hasInitializedRef.current && !isConversationLoading) {
      const existingMessages = conversationData.data.messages;
      if (existingMessages && existingMessages.length > 0) {
        // Convert ConversationMessage[] to UIMessage[]
        const uiMessages: UIMessage[] = existingMessages.map((msg: ConversationMessage) => ({
          id: msg.id,
          role: msg.role,
          parts: msg.parts && msg.parts.length > 0
            ? msg.parts.map(part => {
                if (part.type === "text") {
                  return {
                    type: "text" as const,
                    text: part.text || "",
                  };
                }
                if (part.type === "reasoning") {
                  return {
                    type: "reasoning" as const,
                    text: part.text || "",
                  };
                }
                // Handle tool type - for now just render as text summary
                return {
                  type: "text" as const,
                  text: `[Tool: ${(part as { toolName?: string }).toolName || "unknown"}]`,
                };
              })
            : [{ type: "text" as const, text: msg.content }],
          createdAt: new Date(msg.created_at),
        }));
        setMessages(uiMessages);
        // Show chat area if there are existing messages
        if (uiMessages.length > 0) {
          setShowChatArea(true);
        }
        hasInitializedRef.current = true;
      }
    }
  }, [conversationData, isConversationLoading, setMessages]);

  const chatLoading = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current && chatMessages.length > 0) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const { data: customerData, isLoading } = useCustomer(id);
  const updateMutation = useUpdateCustomer();

  const customer = customerData?.data;

  // Derive form state from customer data
  const formFromCustomer = useMemo(() => {
    if (!customer) return null;
    return {
      name: customer.name ?? "",
      company: customer.company ?? "",
      title: customer.title ?? "",
      phones: (customer.phones ?? []).join(", "),
      emails: (customer.emails ?? []).join(", "),
      wechat: customer.wechat ?? "",
      address: customer.address ?? "",
      tags: (customer.tags ?? []).join(", "),
      decision_chain: customer.decision_chain ?? [],
      profile_markdown: customer.profile_markdown ?? ""
    };
  }, [customer]);

  // Sync form when customer data changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (formFromCustomer) {
      setForm(formFromCustomer);
    }
  }, [formFromCustomer]);

  async function handleCardSave(updatedData: Partial<Customer>) {
    try {
      await updateMutation.mutateAsync({
        id,
        data: updatedData
      });
      setToast("客户信息已更新");
      setEditingCard(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "保存失败");
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-text-secondary">加载中...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-text-secondary">客户不存在</p>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  const hasContact = Boolean(
    form.phones || form.emails || form.wechat
  );

  return (
    <div className="relative min-h-screen bg-bg-primary pb-[220px]">
      <div className="rounded-t-[32px] border border-border bg-bg-primary p-6 shadow-subtle md:mx-auto md:max-w-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/customers"
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface"
          >
            <IconChevronLeft className="h-4 w-4 text-text-secondary" />
          </Link>

          <h1 className="font-display text-xl font-semibold text-text-primary">
            客户详情
          </h1>

          <button
            onClick={() => setIsInfoCollapsed(!isInfoCollapsed)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary"
          >
            {isInfoCollapsed ? "展开" : "收起"}
          </button>
        </div>

        {/* Profile Card */}
        <ProfileCard
          customer={customer}
          isEditing={editingCard === "profileCard"}
          onToggleEdit={() => setEditingCard(editingCard === "profileCard" ? null : "profileCard")}
          onSave={handleCardSave}
        />

        {/* Basic Info Section */}
        <div className="mt-4" style={{ display: isInfoCollapsed ? "none" : "block" }}>
          <BasicInfoSection
            customer={customer}
            isEditing={editingCard === "basicSection"}
            isCollapsed={collapsedCards.has("basicSection")}
            onToggleEdit={() => setEditingCard(editingCard === "basicSection" ? null : "basicSection")}
            onToggleCollapse={() => {
              setCollapsedCards(prev => {
                const newSet = new Set(prev);
                if (newSet.has("basicSection")) {
                  newSet.delete("basicSection");
                } else {
                  newSet.add("basicSection");
                }
                return newSet;
              });
            }}
            onSave={handleCardSave}
          />
        </div>

        {/* Decision Chain Section */}
        <div className="mt-4" style={{ display: isInfoCollapsed ? "none" : "block" }}>
          <DecisionChainSection
            customer={customer}
            isEditing={false}
            onToggleEdit={() => { }}
            onSave={handleCardSave}
          />
        </div>

        {/* Markdown Detail Section */}
        <div className="mt-4" style={{ display: isInfoCollapsed ? "none" : "block" }}>
          <MarkdownDetailSection
            customer={customer}
            isEditing={editingCard === "detailSection"}
            isCollapsed={collapsedCards.has("detailSection")}
            onToggleEdit={() => setEditingCard(editingCard === "detailSection" ? null : "detailSection")}
            onToggleCollapse={() => {
              setCollapsedCards(prev => {
                const newSet = new Set(prev);
                if (newSet.has("detailSection")) {
                  newSet.delete("detailSection");
                } else {
                  newSet.add("detailSection");
                }
                return newSet;
              });
            }}
            onSave={handleCardSave}
          />
        </div>

        {/* 收起/展开提示条 */}
        {isInfoCollapsed && (
          <div className="mt-4 rounded-xl border border-border bg-bg-surface px-4 py-3 text-center">
            <button
              onClick={() => setIsInfoCollapsed(false)}
              className="text-xs font-semibold text-accent"
            >
              展开客户信息
              <IconChevronDown className="ml-1 inline h-3 w-3" />
            </button>
          </div>
        )}

        {/* 对话历史展示区（收起态显示） */}
        {showChatArea && isInfoCollapsed && (
          <div className="mt-4 rounded-2xl border border-border bg-bg-surface p-4">
            <p className="mb-3 text-xs font-semibold text-text-tertiary">
              与 AI 的对话
            </p>
            <div
              ref={chatContainerRef}
              className="space-y-3 max-h-80 overflow-y-auto"
            >
              {chatMessages.length === 0 ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-tl-none bg-bg-secondary px-3 py-2 text-sm text-text-secondary max-w-[80%]">
                    你好！有什么我可以帮助你的吗？
                  </div>
                </div>
              ) : (
                chatMessages.map((msg, msgIndex) => {
                  const isUser = msg.role === "user";
                  const isLastMessage = msgIndex === chatMessages.length - 1;
                  const metadata = msg.metadata as ChatMetadata | undefined;

                  return (
                    <div key={msg.id} className="flex flex-col gap-2">
                      {msg.parts?.map((part, partIndex) => {
                        const isLastPart = partIndex === (msg.parts?.length ?? 0) - 1;
                        
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
                          const isManual = isManualToolInvocationPart(
                            part as ToolUIPart | DynamicToolUIPart,
                            metadata,
                            isLastMessage,
                            chatLoading
                          );
                          return (
                            <div key={`${msg.id}-${partIndex}`} className="flex justify-start">
                              <div className="max-w-[90%]">
                                <ToolMessagePart
                                  part={part as ToolUIPart | DynamicToolUIPart}
                                  isLast={isLastMessage && isLastPart}
                                  isLoading={chatLoading}
                                  isManualToolInvocation={isManual}
                                  addToolResult={addToolResult}
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
              {chatLoading && chatMessages.length > 0 && !chatMessages.at(-1)?.parts?.some(p => p.type === "text" || isToolUIPart(p)) && (
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
              {chatError && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-tl-none bg-red-100 px-3 py-2 text-sm text-red-600 max-w-[80%]">
                    出错了：{chatError.message}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom Spacing */}
        <div className="h-8" />
      </div>

      {/* Fixed AI Input Dock at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-bg-primary/95 backdrop-blur-sm md:mx-auto md:max-w-2xl">
        <div className="border-t border-border p-4">
          <AIInputDock
            contextCustomerId={id}
            contextCustomers={[
              {
                id: customer.id,
                name: customer.name,
                company: customer.company
              }
            ]}
            onSendMessage={async (message, attachments = [], customerIds = []) => {
              setShowChatArea(true);
              setIsInfoCollapsed(true);

              // Store attachments and customer IDs for the prepareSendMessagesRequest
              pendingMessageDataRef.current = {
                rawAttachments: attachments,
                contextCustomerIds: customerIds.length > 0 ? customerIds : [id],
              };

              // Send user message to chat via useChat
              // The prepareSendMessagesRequest will transform this into ChatApiSchemaRequestBody
              await sendMessage({
                text: message,
              });
            }}
            onAddContextCustomer={() => {
              // 可以添加客户选择器
            }}
            onRemoveContextCustomer={() => { }}
            placeholder={`继续提问或补充信息...`}
            loading={chatLoading}
          />
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
