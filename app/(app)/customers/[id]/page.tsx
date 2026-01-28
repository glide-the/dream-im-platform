"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconChevronLeft, IconEdit, IconTrash } from "../../../components/Icons";
import { apiRequest } from "../../../lib/client";
import Toast from "../../../components/Toast";
import ProfileCard from "../../../components/customer-detail/ProfileCard";
import BasicInfoSection from "../../../components/customer-detail/BasicInfoSection";
import MarkdownDetailSection from "../../../components/customer-detail/MarkdownDetailSection";

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
  params: { id: string };
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ data: Customer }>(`/api/customers/${params.id}`)
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
  }, [params.id]);

  function handleFormChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    try {
      const response = await apiRequest<{ data: Customer }>(
        `/api/customers/${params.id}`,
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
      await apiRequest(`/api/customers/${params.id}`, { method: "DELETE" });
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
    <div className="min-h-screen bg-bg-primary">
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

        {/* Bottom Spacing */}
        <div className="h-8" />
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
