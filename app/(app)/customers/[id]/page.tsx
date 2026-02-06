"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import Toast from "../../../components/Toast";
import ProfileCard from "../../../components/customer-detail/ProfileCard";
import BasicInfoSection from "../../../components/customer-detail/BasicInfoSection";
import MarkdownDetailSection from "../../../components/customer-detail/MarkdownDetailSection";
import DecisionChainSection from "../../../components/customer-detail/DecisionChainSection";
import { IconChevronLeft, IconChevronDown } from "../../../components/Icons";
import { ChatPanel } from "../../../components/chat";
import { useCustomer, useUpdateCustomer } from "../../../lib/queries";
import type { Customer } from "../../../lib/types";

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [toast, setToast] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<"profileCard" | "basicSection" | "detailSection" | "decision" | null>(null);
  const [collapsedCards, setCollapsedCards] = useState<Set<"basicSection" | "detailSection">>(new Set());
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);

  const { data: customerData, isLoading } = useCustomer(id);
  const updateMutation = useUpdateCustomer();
  const customer = customerData?.data;

  const contextCustomers = useMemo(
    () => (customer ? [{ id: customer.id, name: customer.name, company: customer.company }] : []),
    [customer],
  );

  async function handleCardSave(updatedData: Partial<Customer>) {
    try {
      await updateMutation.mutateAsync({ id, data: updatedData });
      setToast("客户信息已更新");
      setEditingCard(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "保存失败");
    }
  }

  if (isLoading) return <div className="p-10 text-center text-text-secondary">加载中...</div>;
  if (!customer) return <div className="p-10 text-center text-text-secondary">客户不存在</div>;

  return (
    <div className="space-y-4 pb-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
        <IconChevronLeft className="h-4 w-4" /> 返回首页
      </Link>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
        <h1 className="font-display text-lg font-semibold">{customer.name || "客户详情"}</h1>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-sm"
          onClick={() => setIsInfoCollapsed((v) => !v)}
        >
          客户信息 <IconChevronDown className={`h-4 w-4 transition ${isInfoCollapsed ? "" : "rotate-180"}`} />
        </button>
      </div>

      {!isInfoCollapsed && (
        <div className="space-y-4">
          <ProfileCard
            customer={customer}
            isEditing={editingCard === "profileCard"}
            onToggleEdit={() => setEditingCard(editingCard === "profileCard" ? null : "profileCard")}
            onSave={handleCardSave}
          />
          <BasicInfoSection
            customer={customer}
            isEditing={editingCard === "basicSection"}
            isCollapsed={collapsedCards.has("basicSection")}
            onToggleEdit={() => setEditingCard(editingCard === "basicSection" ? null : "basicSection")}
            onToggleCollapse={() =>
              setCollapsedCards((prev) => {
                const next = new Set(prev);
                if (next.has("basicSection")) next.delete("basicSection");
                else next.add("basicSection");
                return next;
              })
            }
            onSave={handleCardSave}
          />
          <MarkdownDetailSection
            customer={customer}
            isEditing={editingCard === "detailSection"}
            isCollapsed={collapsedCards.has("detailSection")}
            onToggleEdit={() => setEditingCard(editingCard === "detailSection" ? null : "detailSection")}
            onToggleCollapse={() =>
              setCollapsedCards((prev) => {
                const next = new Set(prev);
                if (next.has("detailSection")) next.delete("detailSection");
                else next.add("detailSection");
                return next;
              })
            }
            onSave={handleCardSave}
          />
          <DecisionChainSection
            customer={customer}
            isEditing={editingCard === "decision"}
            onToggleEdit={() => setEditingCard(editingCard === "decision" ? null : "decision")}
            onSave={handleCardSave}
          />
        </div>
      )}

      <ChatPanel threadId={id} contextCustomerId={id} contextCustomers={contextCustomers} className="space-y-3" />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
