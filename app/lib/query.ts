import { Customer, Todo } from "./types";

export function toNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeText(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

export function searchCustomers(customers: Customer[], query: string) {
  const term = normalizeText(query);
  if (!term) return customers;
  return customers.filter((customer) => {
    const haystack = [
      customer.name,
      customer.company,
      customer.title,
      customer.address,
      customer.wechat,
      ...(customer.phones ?? []),
      ...(customer.emails ?? []),
      ...(customer.tags ?? [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

export function filterCustomers(
  customers: Customer[],
  options: { tag?: string; hasContact?: boolean }
) {
  const { tag, hasContact } = options;
  return customers.filter((customer) => {
    if (tag && tag !== "all") {
      const tags = customer.tags ?? [];
      if (!tags.includes(tag)) return false;
    }
    if (hasContact) {
      const hasInfo =
        (customer.phones && customer.phones.length > 0) ||
        (customer.emails && customer.emails.length > 0) ||
        Boolean(customer.wechat);
      if (!hasInfo) return false;
    }
    return true;
  });
}

export function sortCustomers(
  customers: Customer[],
  sortKey: string,
  order: "asc" | "desc"
) {
  const sorted = [...customers];
  const direction = order === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    if (sortKey === "name") {
      return (a.name ?? "").localeCompare(b.name ?? "") * direction;
    }
    if (sortKey === "created_at") {
      return (
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
      ) * direction;
    }
    return (
      new Date(a.updated_at).getTime() -
      new Date(b.updated_at).getTime()
    ) * direction;
  });
  return sorted;
}

export function searchTodos(todos: Todo[], query: string) {
  const term = normalizeText(query);
  if (!term) return todos;
  return todos.filter((todo) => {
    const haystack = [todo.title, todo.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

export function filterTodos(
  todos: Todo[],
  options: { status?: string; priority?: string }
) {
  const { status, priority } = options;
  return todos.filter((todo) => {
    if (status && status !== "all" && todo.status !== status) return false;
    if (priority && priority !== "all" && todo.priority !== priority)
      return false;
    return true;
  });
}

export function sortTodos(
  todos: Todo[],
  sortKey: string,
  order: "asc" | "desc"
) {
  const sorted = [...todos];
  const direction = order === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    if (sortKey === "priority") {
      const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
      return (priorityOrder[a.priority] - priorityOrder[b.priority]) * direction;
    }
    if (sortKey === "created_at") {
      return (
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
      ) * direction;
    }
    return (
      new Date(a.updated_at).getTime() -
      new Date(b.updated_at).getTime()
    ) * direction;
  });
  return sorted;
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return {
    data: items.slice(start, end),
    meta: {
      page: safePage,
      pageSize,
      total,
      totalPages
    }
  };
}
