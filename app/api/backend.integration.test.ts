import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { ApiListResponse } from "../lib/queries";
import type { Customer, Todo, Conversation } from "../lib/types";

type ApiResponse<T = unknown> = {
  status: number;
  json: T;
};

const rawBaseUrl = process.env.BASE_URL;
const BASE_URL =
  rawBaseUrl && rawBaseUrl.startsWith("http")
    ? rawBaseUrl
    : "http://localhost:3000";

async function fetchJson<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const json = await response.json().catch(() => ({})) as T;
  return { status: response.status, json };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/conversations?page=1`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("Server not ready");
}

beforeAll(async () => {
  await waitForServer();
});

describe("Customers API", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds) {
      await fetchJson(`/api/customers/${id}`, { method: "DELETE" }).catch(
        () => {}
      );
    }
    createdIds.length = 0;
  });

  it("lists customers with meta", async () => {
    const { status, json } = await fetchJson<ApiListResponse<Customer>>("/api/customers?page=1&pageSize=2");
    expect(status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.meta).toBeTruthy();
    expect(json.meta.page).toBe(1);
  });

  it("creates, updates, and deletes a customer", async () => {
    const name = `测试客户-${Date.now()}`;
    const { status: createStatus, json: created } = await fetchJson<{ data: Customer }>(
      "/api/customers",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          company: "测试公司",
          title: "采购",
          phones: ["+86 13800000000"],
          emails: ["test@example.com"],
          tags: ["回归测试"]
        })
      }
    );
    expect(createStatus).toBe(201);
    const customerId = created?.data?.id as string;
    expect(customerId).toBeTruthy();
    createdIds.push(customerId);

    const { status: getStatus, json: fetched } = await fetchJson<{ data: Customer }>(
      `/api/customers/${customerId}`
    );
    expect(getStatus).toBe(200);
    expect(fetched.data.name).toBe(name);

    const { status: patchStatus, json: patched } = await fetchJson<{ data: Customer }>(
      `/api/customers/${customerId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title: "采购经理" })
      }
    );
    expect(patchStatus).toBe(200);
    expect(patched.data.title).toBe("采购经理");

    const { status: deleteStatus } = await fetchJson(
      `/api/customers/${customerId}`,
      { method: "DELETE" }
    );
    expect(deleteStatus).toBe(200);
  });
});

describe("Todos API", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds) {
      await fetchJson(`/api/todos/${id}`, { method: "DELETE" }).catch(() => {});
    }
    createdIds.length = 0;
  });

  it("lists todos with stats", async () => {
    const { status, json } = await fetchJson<ApiListResponse<Todo>>("/api/todos?page=1&pageSize=2");
    expect(status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.meta?.stats).toBeTruthy();
  });

  it("creates, updates, and deletes a todo", async () => {
    const title = `测试待办-${Date.now()}`;
    const { status: createStatus, json: created } = await fetchJson<{ data: Todo }>(
      "/api/todos",
      {
        method: "POST",
        body: JSON.stringify({
          title,
          description: "测试描述",
          priority: "P1",
          status: "open"
        })
      }
    );
    expect(createStatus).toBe(201);
    const todoId = created?.data?.id as string;
    expect(todoId).toBeTruthy();
    createdIds.push(todoId);

    const { status: getStatus, json: fetched } = await fetchJson<{ data: Todo }>(
      `/api/todos/${todoId}`
    );
    expect(getStatus).toBe(200);
    expect(fetched.data.title).toBe(title);

    const { status: patchStatus, json: patched } = await fetchJson<{ data: Todo }>(
      `/api/todos/${todoId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "done" })
      }
    );
    expect(patchStatus).toBe(200);
    expect(patched.data.status).toBe("done");

    const { status: deleteStatus } = await fetchJson(`/api/todos/${todoId}`, {
      method: "DELETE"
    });
    expect(deleteStatus).toBe(200);
  });
});

describe("Conversations API", () => {
  it("lists conversations", async () => {
    const { status, json } = await fetchJson<ApiListResponse<Conversation>>(
      "/api/conversations?page=1&pageSize=2"
    );
    expect(status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("updates conversation status", async () => {
    const list = await fetchJson<ApiListResponse<Conversation>>("/api/conversations?page=1&pageSize=1");
    expect(list.status).toBe(200);
    const conv = list.json.data?.[0];
    expect(conv?.id).toBeTruthy();

    const { status: patchStatus, json: patched } = await fetchJson<{ data: Conversation }>(
      `/api/conversations/${conv.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" })
      }
    );
    expect(patchStatus).toBe(200);
    expect(patched.data.status).toBe("confirmed");
  });
});
