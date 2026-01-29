"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { IconChevronLeft, IconEdit, IconTrash, IconChevronDown, IconChevronUp } from "../../../components/Icons";
import { apiRequest } from "../../../lib/client";
import Toast from "../../../components/Toast";
import ProfileCard from "../../../components/customer-detail/ProfileCard";
import BasicInfoSection from "../../../components/customer-detail/BasicInfoSection";
import MarkdownDetailSection from "../../../components/customer-detail/MarkdownDetailSection";
import AIInputDock from "../../../components/AIInputDock";

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
  profile_markdown: ""
};

export default function CustomerDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // 新增状态：对话历史和折叠控制
  const [conversations, setConversations] = useState<any[]>([]);
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);
  const [showChatArea, setShowChatArea] = useState(false);

  useEffect(() => {
    apiRequest<{ data: Customer }>(`/api/customers/${id}`)
      .then((response) => {
        setCustomer(response.data);
        setForm({
          name: response.data.name ?? "",
          company: response.data.company ?? "",
          title: response.data.title ?? "",
          phones: (response.data.phones ?? []).join(", "),
          emails: (response.data.emails ?? []).join(", "),
          wechat: response.data.wechat ?? "",
          address: response.data.address ?? "",
          tags: (response.data.tags ?? []).join(", "),
          profile_markdown: response.data.profile_markdown ?? ""
        });
      })
      .catch(() => setToast("客户不存在或加载失败"))
      .finally(() => setIsLoading(false));
  }, [id]);

  function handleFormChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    try {
      const response = await apiRequest<{ data: Customer }>(
        `/api/customers/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            company: form.company,
            title: form.title,
            phones: form.phones,
            emails: form.emails,
            wechat: form.wechat,
            address: form.address,
            tags: form.tags,
            profile_markdown: form.profile_markdown
          })
        }
      );
      setCustomer(response.data);
      setEditMode(false);
      setToast("客户信息已更新");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function handleDelete() {
    if (!confirm("确定要删除这位客户吗？")) return;

    try {
      await apiRequest(`/api/customers/${id}`, { method: "DELETE" });
      setToast("客户已删除");
      setTimeout(() => {
        window.location.href = "/customers";
      }, 1000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "删除失败");
    }
  }

  function handleCancelEdit() {
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
        profile_markdown: customer.profile_markdown ?? ""
      });
    }
    setEditMode(false);
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (editMode) {
                  handleCancelEdit();
                } else {
                  setEditMode(true);
                }
              }}
              className="rounded-lg bg-accent-light px-3 py-1.5 text-xs font-semibold text-accent"
            >
              {editMode ? "取消" : "编辑"}
            </button>

            {editMode && (
              <button
                onClick={handleSave}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-accent"
              >
                保存
              </button>
            )}
          </div>
        </div>

        {/* Profile Card */}
        <ProfileCard
          name={customer.name}
          company={customer.company}
          title={customer.title}
          tags={customer.tags}
          updated_at={customer.updated_at}
          hasContact={hasContact}
        />

        {/* Basic Info Section */}
        <div className="mt-4">
          <BasicInfoSection
            isEditMode={editMode}
            form={form}
            onFormChange={handleFormChange}
          />
        </div>

        {/* Markdown Detail Section */}
        <div className="mt-4">
          <MarkdownDetailSection
            isEditMode={editMode}
            content={form.profile_markdown}
            onContentChange={(value) => handleFormChange("profile_markdown", value)}
          />
        </div>

        {/* Delete Button (Only in view mode) */}
        {!editMode && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleDelete}
              className="rounded-full border border-red-200 px-6 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50"
            >
              删除客户
            </button>
          </div>
        )}

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
      {!editMode && (
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
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
