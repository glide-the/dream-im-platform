"use client";

import { useEffect, useMemo, useState } from "react";
import { IconSearch, IconPlus, IconEdit, IconTrash } from "../../components/Icons";
import Modal from "../../components/Modal";
import Toast from "../../components/Toast";
import { apiRequest } from "../../lib/client";
import { formatContactStatus, formatRelativeTime } from "../../lib/format";
import { useDebounce } from "../../hooks/useDebounce";
import Link from "next/link";

type Customer = {
  id: string;
  name?: string;
  company?: string;
  title?: string;
  phones?: string[];
  emails?: string[];
  wechat?: string;
  tags?: string[];
  updated_at: string;
};

type CustomerResponse = {
  data: Customer[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    tagOptions: string[];
    totalCustomers: number;
  };
};

const sortOptions = [
  { value: "updated_at", label: "最近更新" },
  { value: "created_at", label: "最近创建" },
  { value: "name", label: "姓名 A-Z" }
];

const emptyForm = {
  name: "",
  company: "",
  title: "",
  phones: "",
  emails: "",
  wechat: "",
  tags: "",
  profile_markdown: ""
};

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [tag, setTag] = useState("all");
  const [hasContact, setHasContact] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [meta, setMeta] = useState<CustomerResponse["meta"]>({
    page: 1,
    pageSize: 6,
    total: 0,
    totalPages: 1,
    tagOptions: [],
    totalCustomers: 0
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const debouncedSearch = useDebounce(search, 300);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(meta.page));
    params.set("pageSize", String(meta.pageSize));
    params.set("search", debouncedSearch);
    params.set("sort", sort);
    params.set("order", order);
    if (tag !== "all") params.set("tag", tag);
    if (hasContact) params.set("hasContact", "1");
    return params.toString();
  }, [debouncedSearch, sort, order, tag, hasContact, meta.page, meta.pageSize]);

  useEffect(() => {
    setLoading(true);
    apiRequest<CustomerResponse>(`/api/customers?${queryString}`)
      .then((response) => {
        setCustomers(response.data);
        setMeta(response.meta);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [queryString]);

  function resetForm() {
    setForm({ ...emptyForm });
  }

  async function handleCreate() {
    if (!form.name && !form.company) {
      setToast("至少填写姓名或公司");
      return;
    }
    try {
      await apiRequest("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          company: form.company,
          title: form.title,
          phones: form.phones,
          emails: form.emails,
          wechat: form.wechat,
          tags: form.tags,
          profile_markdown: form.profile_markdown,
          source: "manual"
        })
      });
      setToast("客户已新增");
      resetForm();
      setModalOpen(false);
      setMeta((prev) => ({ ...prev, page: 1 }));
    } catch (err) {
      setToast(err instanceof Error ? err.message : "新增失败");
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiRequest(`/api/customers/${id}`, { method: "DELETE" });
      setToast("客户已删除");
      setMeta((prev) => ({ ...prev, page: 1 }));
    } catch (err) {
      setToast(err instanceof Error ? err.message : "删除失败");
    }
  }

  const hasResults = customers.length > 0;

  return (
    <div className="relative overflow-hidden rounded-[32px] bg-bg-primary p-6 shadow-subtle md:rounded-[40px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-[var(--color-bg-secondary)] to-[var(--color-bg-primary)]" />
      <div className="pointer-events-none absolute -right-10 top-6 h-44 w-44 rounded-full bg-[radial-gradient(circle,_var(--color-accent-light),_transparent_70%)]" />

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-text-primary">
              客户
            </h1>
            <p className="text-xs text-text-tertiary">
              共 {meta.totalCustomers} 位客户
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-accent"
            onClick={() => setModalOpen(true)}
          >
            <IconPlus className="h-4 w-4" />
            新增客户
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-full border border-border bg-bg-surface px-4 py-2 text-sm text-text-tertiary">
          <IconSearch className="h-4 w-4" />
          <input
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary"
            placeholder="搜索姓名 / 公司 / 联系方式"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <select
            className="rounded-full border border-border bg-bg-secondary px-3 py-1 font-medium text-text-secondary"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                排序：{option.label}
              </option>
            ))}
          </select>
          <button
            className={`rounded-full px-3 py-1 font-medium ${
              hasContact
                ? "bg-accent-light text-accent"
                : "border border-border bg-bg-secondary text-text-secondary"
            }`}
            onClick={() => setHasContact((prev) => !prev)}
          >
            过滤：有联系方式
          </button>
          <select
            className="rounded-full border border-border bg-bg-secondary px-3 py-1 font-medium text-text-secondary"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="all">全部标签</option>
            {meta.tagOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            className="rounded-full border border-border bg-bg-secondary px-3 py-1 font-medium text-text-secondary"
            onClick={() => setOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
          >
            {order === "asc" ? "升序" : "降序"}
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-20 animate-pulse rounded-2xl bg-bg-secondary"
                />
              ))}
            </div>
          ) : hasResults ? (
            customers.map((customer) => {
              const hasContactInfo =
                (customer.phones && customer.phones.length > 0) ||
                (customer.emails && customer.emails.length > 0) ||
                Boolean(customer.wechat);
              return (
                <div
                  key={customer.id}
                  className="rounded-2xl border border-border bg-bg-surface p-4 shadow-subtle"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-semibold text-text-primary">
                        {customer.name || "未命名客户"}
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">
                        {customer.company || "-"} · {customer.title || "-"}
                      </p>
                    </div>
                    <span className="rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {(customer.tags ?? ["普通"])[0]}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
                    <span>最近更新：{formatRelativeTime(customer.updated_at)}</span>
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                      {formatContactStatus(hasContactInfo)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-xs font-semibold text-accent"
                    >
                      查看详情
                    </Link>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/customers/${customer.id}`}
                        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-secondary text-text-secondary"
                      >
                        <IconEdit className="h-4 w-4" />
                      </Link>
                      <button
                        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-secondary text-text-secondary"
                        onClick={() => handleDelete(customer.id)}
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-bg-secondary px-4 py-8 text-center text-xs text-text-tertiary">
              暂无匹配客户，请调整搜索或新增
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between text-xs text-text-tertiary">
          <button
            className="rounded-full border border-border bg-bg-surface px-3 py-1"
            disabled={meta.page <= 1}
            onClick={() => setMeta((prev) => ({ ...prev, page: prev.page - 1 }))}
          >
            上一页
          </button>
          <span>
            第 {meta.page} / {meta.totalPages} 页
          </span>
          <button
            className="rounded-full border border-border bg-bg-surface px-3 py-1"
            disabled={meta.page >= meta.totalPages}
            onClick={() => setMeta((prev) => ({ ...prev, page: prev.page + 1 }))}
          >
            下一页
          </button>
        </div>
      </div>

      <Modal
        open={modalOpen}
        title="新增客户"
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-3 text-sm">
          {[
            { key: "name", label: "姓名" },
            { key: "company", label: "公司" },
            { key: "title", label: "职位" },
            { key: "phones", label: "手机号" },
            { key: "emails", label: "邮箱" },
            { key: "wechat", label: "微信" },
            { key: "tags", label: "标签" }
          ].map((field) => (
            <label key={field.key} className="space-y-1 text-xs">
              <span className="text-text-tertiary">{field.label}</span>
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
            </label>
          ))}
          <label className="space-y-1 text-xs">
            <span className="text-text-tertiary">客户补充信息</span>
            <textarea
              className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm"
              rows={3}
              value={form.profile_markdown}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  profile_markdown: event.target.value
                }))
              }
            />
          </label>
          <button
            className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-accent"
            onClick={handleCreate}
          >
            保存客户
          </button>
        </div>
      </Modal>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
