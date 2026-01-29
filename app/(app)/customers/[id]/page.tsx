"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { IconChevronLeft, IconChevronDown, IconChevronUp } from "../../../components/Icons";
import Toast from "../../../components/Toast";
import ProfileCard from "../../../components/customer-detail/ProfileCard";
import BasicInfoSection from "../../../components/customer-detail/BasicInfoSection";
import MarkdownDetailSection from "../../../components/customer-detail/MarkdownDetailSection";
import DecisionChainSection from "../../../components/customer-detail/DecisionChainSection";
import AIInputDock from "../../../components/AIInputDock";
import { useCustomer, useUpdateCustomer } from "../../../lib/queries";
import type { DecisionChainItem } from "../../../lib/types";

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

  const { data: customerData, isLoading } = useCustomer(id);
  const updateMutation = useUpdateCustomer();

  const customer = customerData?.data;

  // Sync form when customer data changes
  useEffect(() => {
    if (customer) {
      setForm({
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
      });
    }
  }, [customer]);

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
            onToggleEdit={() => {}}
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
            <div className="space-y-3">
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-none bg-bg-secondary px-3 py-2 text-sm text-text-secondary max-w-[80%]">
                  你好！有什么我可以帮助你的吗？
                </div>
              </div>
              <div className="flex justify-end">
                <div className="rounded-2xl rounded-tr-none bg-accent px-3 py-2 text-sm text-white max-w-[80%]">
                  帮我查一下这个客户的背景信息
                </div>
              </div>
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
            onSendMessage={async (message, attachments, customerIds) => {
              console.log("发送消息:", { message, attachments, customerIds });
              setShowChatArea(true);
              setIsInfoCollapsed(true);
            }}
            onAddContextCustomer={() => {
              // 可以添加客户选择器
            }}
            onRemoveContextCustomer={() => {}}
            placeholder={`继续提问或补充信息...`}
            loading={false}
          />
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
