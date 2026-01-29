"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  IconCamera,
  IconImage,
  IconPaperclip,
  IconSend,
  IconSparkles
} from "../../components/Icons";
import Modal from "../../components/Modal";
import Toast from "../../components/Toast";
import AIInputDock from "../../components/AIInputDock";
import { formatRelativeTime } from "../../lib/format";
import { useDebounce } from "../../hooks/useDebounce";
import {
  useSearchCustomer,
  useConversations,
  useCustomers,
  useCreateCustomer,
  useUpdateConversation,
} from "../../lib/queries";

type CustomerCard = {
  structured_fields: {
    name?: string;
    company?: string;
    title?: string;
    phones?: string[];
    emails?: string[];
    wechat?: string;
    address?: string;
    tags?: string[];
  };
  profile_markdown: string;
  confidence?: number;
  sources?: { label: string; url?: string }[];
};

type Conversation = {
  id: string;
  title: string;
  status: "pending" | "confirmed" | "canceled";
  created_at: string;
  updated_at: string;
};

type CustomerOption = {
  id: string;
  name?: string;
  company?: string;
};

type SearchResponse = {
  conversation_id: string;
  customer_card: CustomerCard;
  action_suggestions: string[];
};

const quickPrompts = ["查公司背景", "找手机号/邮箱", "整理成客户档案"];

const emptyCard: CustomerCard = {
  structured_fields: {
    name: "",
    company: "",
    title: "",
    phones: [],
    emails: [],
    wechat: "",
    address: "",
    tags: []
  },
  profile_markdown: ""
};

export default function AiAssistantPageWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AiAssistantPage />
    </Suspense>
  );
}

function AiAssistantPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [editCard, setEditCard] = useState<CustomerCard>(emptyCard);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [attachments, setAttachments] = useState<
    { name: string; type: string; size: number }[]
  >([]);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);
  const [createdCustomerName, setCreatedCustomerName] = useState<string>("");
  const [createdCustomerCompany, setCreatedCustomerCompany] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [contextCustomers, setContextCustomers] = useState<CustomerOption[]>([]);

  const searchParams = useSearchParams();
  const contextCustomerId = searchParams.get("contextCustomerId");

  const debouncedCustomerSearch = useDebounce(customerSearch, 300);

  // React Query hooks
  const { data: conversationsData } = useConversations({ pageSize: 5 });
  const searchMutation = useSearchCustomer();
  const createCustomerMutation = useCreateCustomer();
  const updateConversationMutation = useUpdateConversation();

  // Fetch customer options for context picker
  const { data: customersData } = useCustomers({
    pageSize: 50,
    sort: "updated_at",
    order: "desc"
  });

  const customerOptions = customersData?.data ?? [];
  const history = conversationsData?.data ?? [];

  // Load context customer from URL
  useEffect(() => {
    if (!contextCustomerId) return;
    const customer = customerOptions.find((c) => c.id === contextCustomerId);
    if (customer) {
      addContextCustomer(customer);
    }
  }, [contextCustomerId, customerOptions]);

  const filteredCustomers = useMemo(() => {
    const term = debouncedCustomerSearch.trim().toLowerCase();
    if (!term) return customerOptions;
    return customerOptions.filter((item) => {
      const text = `${item.name ?? ""} ${item.company ?? ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [customerOptions, debouncedCustomerSearch]);

  function syncEditCard(next: CustomerCard) {
    setEditCard({
      ...next,
      structured_fields: {
        name: next.structured_fields.name ?? "",
        company: next.structured_fields.company ?? "",
        title: next.structured_fields.title ?? "",
        phones: next.structured_fields.phones ?? [],
        emails: next.structured_fields.emails ?? [],
        wechat: next.structured_fields.wechat ?? "",
        address: next.structured_fields.address ?? "",
        tags: next.structured_fields.tags ?? []
      }
    });
  }

  async function handleSearch(
    nextQuery: string = query,
    nextAttachments: { name: string; type: string; size: number }[] = attachments,
    nextCustomerIds?: string[]
  ) {
    setError(null);
    if (!nextQuery.trim()) {
      setError("请输入客户单位或姓名");
      return;
    }
    try {
      const response = await searchMutation.mutateAsync({
        query_text: nextQuery,
        attachments: nextAttachments,
        context_customer_ids:
          nextCustomerIds ?? contextCustomers.map((item) => item.id)
      });
      setCard(response.customer_card);
      syncEditCard(response.customer_card);
      setConversationId(response.conversation_id);
      setEditMode(false);
      setToast("已生成客户资料卡片，请确认后入库");
    } catch (err) {
      setError(err instanceof Error ? err.message : "检索失败");
      setCard(null);
      setConversationId(null);
    }
  }

  async function handleConfirm() {
    if (!editCard) return;
    try {
      // 定义API响应类型
      type CreateCustomerResponse = { data: { id: string } };
      
      const result = await createCustomerMutation.mutateAsync({
        name: editCard.structured_fields.name,
        company: editCard.structured_fields.company,
        title: editCard.structured_fields.title,
        phones: editCard.structured_fields.phones,
        emails: editCard.structured_fields.emails,
        wechat: editCard.structured_fields.wechat,
        address: editCard.structured_fields.address,
        tags: editCard.structured_fields.tags,
        profile_markdown: editCard.profile_markdown,
        source: "ai_search",
        conversation_id: conversationId
      } as any);
      
      // Extract customer ID and info from the response
      const customerId = (result as CreateCustomerResponse)?.data?.id || "";
      const customerName = editCard.structured_fields.name || "客户";
      const customerCompany = editCard.structured_fields.company || "";
      
      setCreatedCustomerId(customerId);
      setCreatedCustomerName(customerName);
      setCreatedCustomerCompany(customerCompany);
      setSuccessModalOpen(true);
      
      setEditMode(false);
      setCard(null);
      setEditCard(emptyCard);
      setConversationId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "入库失败");
    }
  }

  async function handleCancel() {
    if (!conversationId) {
      setCard(null);
      return;
    }
    try {
      await updateConversationMutation.mutateAsync({
        id: conversationId,
        data: { status: "canceled" }
      });
      setToast("已取消，未新增客户");
      setCard(null);
      setConversationId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    }
  }

  function handleAttachment(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).map((file) => ({
      name: file.name,
      type: file.type || "file",
      size: file.size
    }));
    setAttachments((prev) => [...prev, ...list]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, idx) => idx !== index));
  }

  function addContextCustomer(customer: CustomerOption) {
    setContextCustomers((prev) => {
      if (prev.some((item) => item.id === customer.id)) return prev;
      return [...prev, customer];
    });
    setQuery((prev) =>
      prev.includes("@")
        ? prev
        : `${prev}${prev ? " " : ""}@${customer.name ?? "客户"}(${
            customer.company ?? ""
          })`
    );
    setCustomerModalOpen(false);
  }

  function removeContextCustomer(id: string) {
    setContextCustomers((prev) => prev.filter((item) => item.id !== id));
    setQuery((prev) => prev.replace(/@[^\s]+\([^)]*\)/g, "").trim());
  }

  const statusTone = (status: Conversation["status"]) => {
    if (status === "confirmed") return "bg-emerald-100 text-emerald-600";
    if (status === "canceled") return "bg-rose-100 text-rose-600";
    return "bg-accent-light text-accent";
  };

  return (
    <div className="relative min-h-screen bg-bg-primary">
      <div className="mx-auto max-w-2xl rounded-[32px] bg-bg-primary shadow-subtle md:rounded-[40px]">
        <div className="relative overflow-y-auto pb-[280px]">
          <div className="p-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-linear-to-b from-bg-secondary to-bg-primary" />
            <div className="pointer-events-none absolute -left-12 top-20 h-44 w-44 rounded-full bg-[radial-gradient(circle,var(--color-accent-light),transparent_70%)]" />
            <div className="pointer-events-none absolute -right-12 top-4 h-52 w-52 rounded-full bg-[radial-gradient(circle,var(--color-accent-light),transparent_70%)]" />

          <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="font-display text-xl font-semibold text-text-primary">
              AI 助手
            </p>
            <span className="rounded-full border border-border bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent">
              Beta
            </span>
          </div>
          <button
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-surface text-text-secondary"
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
              } else {
                router.push('/customers');
              }
            }}
          >
            ×
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <h1 className="font-display text-2xl font-semibold text-text-primary">
            你好，今天要找谁？
          </h1>
          <p className="text-sm text-text-secondary">
            输入“公司 + 姓名”，AI 30 秒生成可编辑客户档案
          </p>
        </div>

        <div className="mt-6 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            快捷输入
          </p>
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((item) => (
              <button
                type="button"
                key={item}
                className="rounded-full border border-border bg-bg-surface px-3 py-1 text-xs font-medium text-text-secondary shadow-subtle"
                onClick={() => setQuery(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              对话历史
            </p>
            <span className="text-xs font-semibold text-accent">
              最近 {history.length} 条
            </span>
          </div>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-bg-secondary px-4 py-6 text-center text-xs text-text-tertiary">
              暂无对话历史，先发起一次检索吧
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-bg-secondary px-3 py-2"
              >
                <span className="h-2 w-2 rounded-full bg-accent" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {item.title}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {formatRelativeTime(item.updated_at)} ·
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(
                        item.status
                      )}`}
                    >
                      {item.status === "pending"
                        ? "未入库"
                        : item.status === "confirmed"
                        ? "已入库"
                        : "已取消"}
                    </span>
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-bg-surface p-4 shadow-medium">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">客户资料卡片</p>
            <span className="rounded-full bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent">
              {searchMutation.isPending
                ? "检索中"
                : card
                ? editMode
                  ? "编辑中"
                  : "待确认"
                : "等待检索"}
            </span>
          </div>
          {error ? (
            <p className="mt-3 text-xs text-rose-500">{error}</p>
          ) : null}
          {!card && !searchMutation.isPending ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-bg-secondary px-4 py-6 text-center text-xs text-text-tertiary">
              输入客户单位 + 姓名开始检索，或手动填写后入库
            </div>
          ) : null}
          {searchMutation.isPending ? (
            <div className="mt-4 space-y-2">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-8 animate-pulse rounded-xl bg-bg-secondary"
                />
              ))}
            </div>
          ) : null}

          {card ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  {
                    label: "姓名",
                    value: editCard.structured_fields.name,
                    key: "name"
                  },
                  {
                    label: "公司",
                    value: editCard.structured_fields.company,
                    key: "company"
                  },
                  {
                    label: "职位",
                    value: editCard.structured_fields.title,
                    key: "title"
                  },
                  {
                    label: "手机号",
                    value: (editCard.structured_fields.phones ?? []).join(", "),
                    key: "phones"
                  },
                  {
                    label: "邮箱",
                    value: (editCard.structured_fields.emails ?? []).join(", "),
                    key: "emails"
                  },
                  {
                    label: "微信",
                    value: editCard.structured_fields.wechat ?? "",
                    key: "wechat"
                  },
                  {
                    label: "地址",
                    value: editCard.structured_fields.address ?? "",
                    key: "address"
                  },
                  {
                    label: "标签",
                    value: (editCard.structured_fields.tags ?? []).join(", "),
                    key: "tags"
                  }
                ].map((field) => (
                  <label key={field.key} className="space-y-1 text-xs">
                    <span className="text-text-tertiary">{field.label}</span>
                    {editMode ? (
                      <input
                        className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary"
                        value={field.value}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEditCard((prev) => {
                            const structured = { ...prev.structured_fields };
                            if (field.key === "phones") {
                              structured.phones = value
                                .split(/[,，]/)
                                .map((item) => item.trim())
                                .filter(Boolean);
                            } else if (field.key === "emails") {
                              structured.emails = value
                                .split(/[,，]/)
                                .map((item) => item.trim())
                                .filter(Boolean);
                            } else if (field.key === "tags") {
                              structured.tags = value
                                .split(/[,，]/)
                                .map((item) => item.trim())
                                .filter(Boolean);
                            } else if (field.key === "name") {
                              structured.name = value;
                            } else if (field.key === "company") {
                              structured.company = value;
                            } else if (field.key === "title") {
                              structured.title = value;
                            } else if (field.key === "wechat") {
                              structured.wechat = value;
                            } else if (field.key === "address") {
                              structured.address = value;
                            }
                            return { ...prev, structured_fields: structured };
                          });
                        }}
                      />
                    ) : (
                      <p className="rounded-xl bg-bg-secondary px-3 py-2 text-sm font-semibold text-text-primary">
                        {field.value || "-"}
                      </p>
                    )}
                  </label>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-bg-secondary p-3">
                <p className="text-xs font-semibold text-text-tertiary">
                  更多维度信息
                </p>
                {editMode ? (
                  <textarea
                    className="mt-2 w-full rounded-xl border border-border bg-bg-surface px-3 py-2 text-xs leading-relaxed text-text-secondary"
                    rows={4}
                    value={editCard.profile_markdown}
                    onChange={(event) =>
                      setEditCard((prev) => ({
                        ...prev,
                        profile_markdown: event.target.value
                      }))
                    }
                  />
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary whitespace-pre-line">
                    {editCard.profile_markdown || "暂无补充信息"}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] text-text-tertiary">
                {(card.sources ?? []).map((source) => (
                  <span
                    key={source.label}
                    className="rounded-full border border-border bg-bg-surface px-2 py-1"
                  >
                    {source.label}
                  </span>
                ))}
                <span className="rounded-full bg-bg-secondary px-2 py-1">
                  可信度 {(card.confidence ?? 0) * 100}%
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-accent disabled:opacity-50"
                  onClick={handleConfirm}
                  disabled={searchMutation.isPending}
                >
                  确认新增
                </button>
                <button
                  className="flex-1 rounded-full border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-secondary"
                  onClick={() => setEditMode((prev) => !prev)}
                >
                  {editMode ? "完成编辑" : "修改"}
                </button>
              </div>
              <button
                className="mt-2 w-full text-center text-xs font-semibold text-text-tertiary"
                onClick={handleCancel}
              >
                取消入库
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute -bottom-6 right-6 hidden rounded-full bg-accent-light p-3 text-accent shadow-subtle md:flex">
        <IconSparkles className="h-6 w-6" />
      </div>

      <Modal
        open={customerModalOpen}
        title="选择上下文客户"
        onClose={() => setCustomerModalOpen(false)}
      >
        <div className="space-y-3">
          <input
            className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm"
            placeholder="搜索客户"
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
          />
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-bg-surface px-3 py-2 text-left text-sm"
                onClick={() => addContextCustomer(customer)}
              >
                <span>
                  {customer.name ?? "未命名"}
                  <span className="ml-2 text-xs text-text-tertiary">
                    {customer.company}
                  </span>
                </span>
                <span className="text-xs text-text-tertiary">添加</span>
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Success Modal */}
      <Modal
        open={successModalOpen}
        title="客户已新增"
        onClose={() => setSuccessModalOpen(false)}
      >
        <div className="space-y-4 text-center">
          <div className="rounded-full bg-accent-light mx-auto w-16 h-16 flex items-center justify-center">
            <span className="text-3xl">✓</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">客户已新增</h3>
            <p className="mt-2 text-sm text-text-secondary">
              {createdCustomerName}
              {createdCustomerCompany && ` · ${createdCustomerCompany}`}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-accent"
              onClick={() => {
                setSuccessModalOpen(false);
                if (createdCustomerId) {
                  router.push(`/customers/${createdCustomerId}`);
                }
              }}
            >
              查看客户详情
            </button>
            <button
              className="w-full rounded-full border border-border bg-bg-surface px-4 py-2 text-sm font-semibold text-text-secondary"
              onClick={() => {
                setSuccessModalOpen(false);
              }}
            >
              继续对话
            </button>
          </div>
        </div>
      </Modal>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
          </div>
        </div>
      </div>

      {/* Fixed AI Input Dock at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-bg-primary/95 backdrop-blur-sm md:mx-auto md:max-w-2xl">
        <div className="border-t border-border p-4">
          <AIInputDock
            contextCustomerId={contextCustomerId ?? undefined}
            contextCustomers={contextCustomers}
            onSendMessage={async (message, newAttachments, customerIds) => {
              const safeAttachments = newAttachments ?? [];
              const safeCustomerIds =
                customerIds ?? contextCustomers.map((item) => item.id);
              setQuery(message);
              setAttachments(safeAttachments);
              await handleSearch(message, safeAttachments, safeCustomerIds);
            }}
            onAddContextCustomer={() => setCustomerModalOpen(true)}
            onRemoveContextCustomer={(id) => removeContextCustomer(id)}
            placeholder="输入公司 + 姓名…"
            loading={searchMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}
