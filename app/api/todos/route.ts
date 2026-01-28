import { NextResponse } from "next/server";
import { createTodo, listTodos } from "../../lib/db";
import { createId } from "../../lib/id";
import { toNumber } from "../../lib/query";
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

  const result = await listTodos({
    page,
    pageSize,
    search,
    sort,
    order,
    status,
    priority
  });

  return NextResponse.json({
    data: result.data,
    meta: result.meta
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

  const result = await createTodo(todo);

  return NextResponse.json({ data: result }, { status: 201 });
}
