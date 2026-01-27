import { NextResponse } from "next/server";
import { readDb, withDb } from "../../lib/db";
import { createId } from "../../lib/id";
import { filterTodos, paginate, searchTodos, sortTodos, toNumber } from "../../lib/query";
import { Todo, TodoPriority, TodoStatus } from "../../lib/types";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = toNumber(searchParams.get("page"), 1);
  const pageSize = toNumber(searchParams.get("pageSize"), 6);
  const search = searchParams.get("search") ?? "";
  const sort = searchParams.get("sort") ?? "updated_at";
  const order = (searchParams.get("order") ?? "desc") as "asc" | "desc";
  const status = searchParams.get("status") ?? "";
  const priority = searchParams.get("priority") ?? "";

  const db = await readDb();
  let result = searchTodos(db.todos, search);
  result = filterTodos(result, { status, priority });
  result = sortTodos(result, sort, order);

  const { data, meta } = paginate(result, page, pageSize);

  const stats = db.todos.reduce(
    (acc, todo) => {
      if (todo.status === "done") acc.done += 1;
      if (todo.status === "open") acc.open += 1;
      if (todo.status === "open" && todo.priority === "P0") acc.high += 1;
      return acc;
    },
    { open: 0, done: 0, high: 0 }
  );

  return NextResponse.json({
    data,
    meta: {
      ...meta,
      stats,
      totalTodos: db.todos.length
    }
  });
}

export async function POST(request: Request) {
  let body: Partial<Todo> | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("请求体格式错误");
  }

  const title = body?.title?.trim();
  if (!title) {
    return jsonError("请输入待办标题");
  }

  const now = new Date().toISOString();
  const todo: Todo = {
    id: createId("todo"),
    title,
    description: body?.description?.trim() || "",
    priority: (body?.priority as TodoPriority) ?? "P2",
    status: (body?.status as TodoStatus) ?? "open",
    created_at: now,
    updated_at: now
  };

  const result = await withDb((db) => ({
    db: {
      ...db,
      todos: [todo, ...db.todos]
    },
    result: todo
  }));

  return NextResponse.json({ data: result }, { status: 201 });
}
