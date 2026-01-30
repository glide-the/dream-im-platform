"use client";

import { useMemo, useState } from "react";
import { IconCircle, IconSearch, IconPlus, IconEdit, IconTrash } from "../../components/Icons";
import Modal from "../../components/Modal";
import Toast from "../../components/Toast";
import { formatRelativeTime } from "../../lib/format";
import { useDebounce } from "../../hooks/useDebounce";
import {
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
} from "../../lib/queries";

type Todo = {
  id: string;
  title: string;
  description?: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: "open" | "done";
  updated_at: string;
};

type TodoForm = {
  id: string;
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: "open" | "done";
};

const emptyForm: TodoForm = {
  id: "",
  title: "",
  description: "",
  priority: "P2",
  status: "open"
};

export default function TodoPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState("updated_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TodoForm>(emptyForm);
  const [toast, setToast] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useTodos({
    page,
    pageSize: 6,
    search: debouncedSearch,
    sort,
    order,
    status,
    priority,
  });

  const createMutation = useCreateTodo();
  const updateMutation = useUpdateTodo();
  const deleteMutation = useDeleteTodo();

  const todos = data?.data ?? [];
  const meta = data?.meta ?? {
    page: 1,
    pageSize: 6,
    total: 0,
    totalPages: 1,
    stats: { open: 0, done: 0, high: 0 },
    totalTodos: 0
  };

  function openCreate() {
    setForm({ ...emptyForm });
    setModalOpen(true);
  }

  function openEdit(todo: Todo) {
    setForm({
      id: todo.id,
      title: todo.title,
      description: todo.description ?? "",
      priority: todo.priority,
      status: todo.status
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      setToast("请输入待办标题");
      return;
    }
    try {
      if (form.id) {
        await updateMutation.mutateAsync({
          id: form.id,
          data: {
            title: form.title,
            description: form.description,
            priority: form.priority,
            status: form.status
          }
        });
        setToast("待办已更新");
      } else {
        await createMutation.mutateAsync({
          title: form.title,
          description: form.description,
          priority: form.priority,
          status: form.status
        });
        setToast("待办已创建");
      }
      setModalOpen(false);
      setPage(1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function toggleStatus(todo: Todo) {
    try {
      await updateMutation.mutateAsync({
        id: todo.id,
        data: {
          status: todo.status === "open" ? "done" : "open"
        }
      });
      setToast("状态已更新");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "更新失败");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id);
      setToast("待办已删除");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[32px] bg-bg-primary p-6 shadow-subtle md:rounded-[40px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-linear-to-b from-bg-secondary to-bg-primary" />
      <div className="pointer-events-none absolute -left-10 top-6 h-44 w-44 rounded-full bg-[radial-gradient(circle,var(--color-accent-light),transparent_70%)]" />

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-text-primary">
              待办
            </h1>
            <p className="text-xs text-text-tertiary">
              共 {meta.totalTodos} 项待办
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-accent"
            onClick={openCreate}
          >
            <IconPlus className="h-4 w-4" />
            新建待办
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "未完成", value: meta.stats.open },
            { label: "高优先级", value: meta.stats.high, accent: true },
            { label: "已完成", value: meta.stats.done }
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-border bg-bg-surface p-3 text-center"
            >
              <p className="text-xs text-text-tertiary">{stat.label}</p>
              <p
                className={`mt-1 text-lg font-semibold ${
                  stat.accent ? "text-accent" : "text-text-primary"
                }`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-full border border-border bg-bg-surface px-4 py-2 text-sm text-text-tertiary">
          <IconSearch className="h-4 w-4" />
          <input
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary"
            placeholder="搜索待办标题/描述"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {[
            { label: "全部", value: "all" },
            { label: "未完成", value: "open" },
            { label: "已完成", value: "done" }
          ].map((chip) => (
            <button
              key={chip.value}
              className={`rounded-full px-3 py-1 font-medium ${
                status === chip.value
                  ? "bg-accent-light text-accent"
                  : "border border-border bg-bg-secondary text-text-secondary"
              }`}
              onClick={() => setStatus(chip.value)}
            >
              {chip.label}
            </button>
          ))}
          {[
            { label: "全部优先级", value: "all" },
            { label: "P0", value: "P0" },
            { label: "P1", value: "P1" },
            { label: "P2", value: "P2" },
            { label: "P3", value: "P3" }
          ].map((chip) => (
            <button
              key={chip.value}
              className={`rounded-full px-3 py-1 font-medium ${
                priority === chip.value
                  ? "bg-accent-light text-accent"
                  : "border border-border bg-bg-secondary text-text-secondary"
              }`}
              onClick={() => setPriority(chip.value)}
            >
              {chip.label}
            </button>
          ))}
          <select
            className="rounded-full border border-border bg-bg-secondary px-3 py-1 font-medium text-text-secondary"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="updated_at">排序：最近更新</option>
            <option value="created_at">排序：最近创建</option>
            <option value="priority">排序：优先级</option>
          </select>
          <button
            className="rounded-full border border-border bg-bg-secondary px-3 py-1 font-medium text-text-secondary"
            onClick={() => setOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
          >
            {order === "asc" ? "升序" : "降序"}
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-16 animate-pulse rounded-2xl bg-bg-secondary"
                />
              ))}
            </div>
          ) : todos.length > 0 ? (
            todos.map((todo) => (
              <div
                key={todo.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-bg-surface p-3"
              >
                <button
                  className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold ${
                    todo.priority === "P0"
                      ? "bg-accent-light text-accent"
                      : "bg-bg-secondary text-text-secondary"
                  }`}
                  onClick={() => toggleStatus(todo)}
                >
                  {todo.priority}
                </button>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {todo.title}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {todo.description || "暂无描述"}
                  </p>
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    更新：{formatRelativeTime(todo.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-secondary text-text-secondary"
                    onClick={() => openEdit(todo)}
                  >
                    <IconEdit className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-secondary text-text-secondary"
                    onClick={() => handleDelete(todo.id)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
                <IconCircle
                  className={`h-5 w-5 ${
                    todo.status === "done" ? "text-emerald-500" : "text-text-tertiary"
                  }`}
                />
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-bg-secondary px-4 py-8 text-center text-xs text-text-tertiary">
              暂无待办，点击右上角新增
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between text-xs text-text-tertiary">
          <button
            className="rounded-full border border-border bg-bg-surface px-3 py-1"
            disabled={page <= 1}
            onClick={() => setPage((prev) => prev - 1)}
          >
            上一页
          </button>
          <span>
            第 {meta.page} / {meta.totalPages} 页
          </span>
          <button
            className="rounded-full border border-border bg-bg-surface px-3 py-1"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((prev) => prev + 1)}
          >
            下一页
          </button>
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={form.id ? "编辑待办" : "新建待办"}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-3 text-sm">
          <label className="space-y-1 text-xs">
            <span className="text-text-tertiary">标题</span>
            <input
              className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm"
              value={form.title}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-text-tertiary">描述</span>
            <textarea
              className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-2 text-sm"
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["P0", "P1", "P2", "P3"] as const).map((level) => (
              <button
                key={level}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  form.priority === level
                    ? "bg-accent-light text-accent"
                    : "border border-border bg-bg-secondary text-text-secondary"
                }`}
                onClick={() => setForm((prev) => ({ ...prev, priority: level }))}
              >
                {level}
              </button>
            ))}
            {(["open", "done"] as const).map((state) => (
              <button
                key={state}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  form.status === state
                    ? "bg-emerald-100 text-emerald-600"
                    : "border border-border bg-bg-secondary text-text-secondary"
                }`}
                onClick={() => setForm((prev) => ({ ...prev, status: state }))}
              >
                {state === "open" ? "未完成" : "已完成"}
              </button>
            ))}
          </div>
          <button
            className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-accent"
            onClick={handleSave}
          >
            保存待办
          </button>
        </div>
      </Modal>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
