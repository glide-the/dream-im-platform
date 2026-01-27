import { NextResponse } from "next/server";
import { readDb, withDb } from "../../../lib/db";
import { Todo, TodoPriority, TodoStatus } from "../../../lib/types";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const db = await readDb();
  const todo = db.todos.find((item) => item.id === params.id);
  if (!todo) {
    return jsonError("待办不存在", 404);
  }
  return NextResponse.json({ data: todo });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  let body: Partial<Todo> | null = null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("请求体格式错误");
  }

  const now = new Date().toISOString();

  const updated = await withDb((db) => {
    const index = db.todos.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return { db, result: null };
    }
    const current = db.todos[index];
    const next: Todo = {
      ...current,
      title: body?.title?.trim() ?? current.title,
      description: body?.description?.trim() ?? current.description,
      priority: (body?.priority as TodoPriority) ?? current.priority,
      status: (body?.status as TodoStatus) ?? current.status,
      updated_at: now
    };
    const todos = [...db.todos];
    todos[index] = next;
    return { db: { ...db, todos }, result: next };
  });

  if (!updated) {
    return jsonError("待办不存在", 404);
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const deleted = await withDb((db) => {
    const exists = db.todos.some((item) => item.id === params.id);
    if (!exists) {
      return { db, result: null };
    }
    return {
      db: {
        ...db,
        todos: db.todos.filter((item) => item.id !== params.id)
      },
      result: true
    };
  });

  if (!deleted) {
    return jsonError("待办不存在", 404);
  }

  return NextResponse.json({ success: true });
}
