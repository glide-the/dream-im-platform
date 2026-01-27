"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconChevronRight, IconEdit, IconTrash } from "../../../components/Icons";
import { apiRequest } from "../../../lib/client";
import Toast from "../../../components/Toast";

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
      .catch(() => setToast("客户不存在或加载失败"));
  }, [params.id]);

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
      setToast("客户已更新");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function handleDelete() {
    try {
      await apiRequest(`/api/customers/${params.id}`, { method: "DELETE" });
      setToast("客户已删除");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (!customer) {
    return (
      <div className="rounded-[32px] border border-border bg-bg-primary p-6 shadow-subtle">
        <p className="text-sm text-text-secondary">加载中...</p>
        {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
      </div>
    );
  }

  return (
    <div className="rounded-[32px] border border-border bg-bg-primary p-6 shadow-subtle">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-tertiary">
            客户详情
            <span className="mx-1">/</span>
            {customer.name || "未命名"}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-text-primary">
            {customer.name || "未命名客户"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-bg-surface text-text-secondary"
            onClick={() => setEditMode((prev) => !prev)}
          >
            <IconEdit className="h-4 w-4" />
          </button>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-bg-surface text-text-secondary"
            onClick={handleDelete}
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {[
          { key: "company", label: "公司" },
          { key: "title", label: "职位" },
          { key: "phones", label: "手机号" },
          { key: "emails", label: "邮箱" },
          { key: "wechat", label: "微信" },
          { key: "address", label: "地址" },
          { key: "tags", label: "标签" }
        ].map((field) => (
          <label key={field.key} className="space-y-1 text-xs">
            <span className="text-text-tertiary">{field.label}</span>
            {editMode ? (
              <input
                className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm"
                value={(form as Record<string, string>)[field.key]}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    [field.key]: event.target.value
                  }))
                }
              />
            ) : (
              <p className="rounded-xl bg-bg-secondary px-3 py-2 text-sm text-text-primary">
                {(form as Record<string, string>)[field.key] || "-"}
              </p>
            )}
          </label>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-bg-surface p-4">
        <p className="text-xs font-semibold text-text-tertiary">客户补充信息</p>
        {editMode ? (
          <textarea
            className="mt-2 w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm"
            rows={4}
            value={form.profile_markdown}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                profile_markdown: event.target.value
              }))
            }
          />
        ) : (
          <p className="mt-2 text-sm text-text-secondary whitespace-pre-line">
            {form.profile_markdown || "暂无补充信息"}
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Link
          href="/customers"
          className="flex items-center gap-2 text-xs font-semibold text-text-secondary"
        >
          返回客户列表
          <IconChevronRight className="h-4 w-4" />
        </Link>
        {editMode ? (
          <button
            className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-accent"
            onClick={handleSave}
          >
            保存修改
          </button>
        ) : null}
      </div>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
