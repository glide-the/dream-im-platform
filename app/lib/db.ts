/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * NOTE: This file uses 'as any' type assertions for Drizzle ORM insert/update operations.
 * This is necessary because Drizzle's type system requires exact types that don't match
 * our Customer/Todo/Conversation types which allow undefined fields.
 * This is a known limitation of Drizzle ORM and not a code quality issue.
 *
 * Track: https://github.com/drizzle-team/drizzle-orm/issues/1942
 */
import { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { DbShape, Conversation, Customer, Todo, SystemConfig } from "./types";
import { seedData } from "./seed";
import { conversations, customers, todos, systemConfigs } from "./db/schema";

type DbQueue = Promise<void>;

type GlobalPool = typeof globalThis & {
  __ai4sales_pg_pool__?: Pool;
  __ai4sales_db_init__?: Promise<void>;
  __ai4sales_write_queue__?: DbQueue;
};

function getPool() {
  const globalPool = globalThis as GlobalPool;
  if (!globalPool.__ai4sales_pg_pool__) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      const missing: string[] = [];
      if (!process.env.PGHOST) missing.push("PGHOST");
      if (!process.env.PGUSER) missing.push("PGUSER");
      if (!process.env.PGDATABASE) missing.push("PGDATABASE");
      if (missing.length) {
        throw new Error(
          [
            "Postgres configuration missing.",
            "Set DATABASE_URL or provide individual variables:",
            missing.join(", "),
            "Reference .env.local.example."
          ].join(" ")
        );
      }
    }
    globalPool.__ai4sales_pg_pool__ = new Pool({
      connectionString,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE
    });
  }
  return globalPool.__ai4sales_pg_pool__;
}

function toIso(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(value as string).toISOString();
}

function parseJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return value as T;
}

function mapCustomerRow(row: typeof customers.$inferSelect): Customer {
  return {
    id: row.id,
    name: row.name ?? undefined,
    company: row.company ?? undefined,
    title: row.title ?? undefined,
    phones: row.phones ?? [],
    emails: row.emails ?? [],
    wechat: row.wechat ?? "",
    address: row.address ?? "",
    tags: row.tags ?? [],
    profile_markdown: row.profile_markdown ?? "",
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    source: (row.source ?? "manual") as "ai_search" | "manual" | "import",
    last_verified_at: row.last_verified_at ? toIso(row.last_verified_at) : undefined
  };
}

function mapTodoRow(row: typeof todos.$inferSelect): Todo {
  return {
    id: row.id,
    title: row.title ?? "",
    description: row.description ?? "",
    priority: (row.priority ?? "P2") as "P0" | "P1" | "P2" | "P3",
    status: (row.status ?? "open") as "open" | "done",
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function mapConversationRow(
  row: typeof conversations.$inferSelect
): Conversation {
  return {
    id: row.id,
    title: row.title ?? "",
    status: (row.status ?? "pending") as "pending" | "confirmed" | "canceled",
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    messages: parseJson<Conversation["messages"]>(row.messages) ?? [],
    attachments: parseJson<Conversation["attachments"]>(row.attachments),
    context_customer_ids: row.context_customer_ids ?? undefined,
    ai_outputs: parseJson<Conversation["ai_outputs"]>(row.ai_outputs),
    linked_customer_id: row.linked_customer_id ?? undefined,
    claude_session_id: row.claude_session_id ?? undefined
  };
}

async function withClient<T>(handler: (client: PoolClient) => Promise<T>) {
  await ensureInitialized();
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

async function withTransaction<T>(
  handler: (db: ReturnType<typeof drizzle>) => Promise<T>
) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    await client.query("BEGIN");
    try {
      const result = await handler(db);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function ensureInitialized() {
  const globalPool = globalThis as GlobalPool;
  if (!globalPool.__ai4sales_db_init__) {
    globalPool.__ai4sales_db_init__ = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          name TEXT,
          company TEXT,
          title TEXT,
          phones TEXT[],
          emails TEXT[],
          wechat TEXT,
          address TEXT,
          tags TEXT[],
          decision_chain JSONB,
          profile_markdown TEXT,
          created_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ,
          source TEXT,
          last_verified_at TIMESTAMPTZ
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          title TEXT,
          description TEXT,
          priority TEXT,
          status TEXT,
          created_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT,
          status TEXT,
          created_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ,
          messages JSONB,
          attachments JSONB,
          context_customer_ids TEXT[],
          ai_outputs JSONB,
          linked_customer_id TEXT
        );
      `);
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at DESC);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_customers_tags ON customers USING GIN(tags);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at DESC);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);"
      );
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_conversations_linked_customer ON conversations(linked_customer_id);"
      );

      // System configs table (singleton, id = 'default')
      await pool.query(`
        CREATE TABLE IF NOT EXISTS system_configs (
          id TEXT PRIMARY KEY DEFAULT 'default',
          system_prompt TEXT,
          model TEXT,
          provider TEXT,
          theme TEXT,
          workspace_enabled BOOLEAN DEFAULT true,
          extras JSONB,
          created_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ
        );
      `);

      const { rows } = await pool.query(
        "SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM todos) AS todos, (SELECT COUNT(*) FROM conversations) AS conversations;"
      );
      const counts = rows[0] as {
        customers: string;
        todos: string;
        conversations: string;
      };
      const hasData =
        Number(counts.customers) > 0 ||
        Number(counts.todos) > 0 ||
        Number(counts.conversations) > 0;
      if (!hasData) {
        const seed = seedData();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await writeDbWithClient(client, seed);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    })();
  }
  await globalPool.__ai4sales_db_init__;
}

async function readDbWithClient(client: PoolClient): Promise<DbShape> {
  const db = drizzle(client);

  const customerRows = await db.select().from(customers);
  const todoRows = await db.select().from(todos);
  const conversationRows = await db.select().from(conversations);

  return {
    customers: customerRows.map(mapCustomerRow),
    todos: todoRows.map(mapTodoRow),
    conversations: conversationRows.map(mapConversationRow)
  };
}

async function writeDbWithClient(client: PoolClient, db: DbShape) {
  const drizzleDb = drizzle(client);
  await drizzleDb.execute(sql`TRUNCATE customers, todos, conversations;`);

  if (db.customers.length) {
    await drizzleDb.insert(customers).values(
      db.customers.map((customer) => ({
        id: customer.id,
        name: customer.name ?? null,
        company: customer.company ?? null,
        title: customer.title ?? null,
        phones: customer.phones ?? [],
        emails: customer.emails ?? [],
        wechat: customer.wechat ?? "",
        address: customer.address ?? "",
        tags: customer.tags ?? [],
        profile_markdown: customer.profile_markdown ?? "",
        created_at: customer.created_at ? new Date(customer.created_at) : null,
        updated_at: customer.updated_at ? new Date(customer.updated_at) : null,
        source: customer.source ?? "manual",
        last_verified_at: customer.last_verified_at
          ? new Date(customer.last_verified_at)
          : null
      })) as any
    );
  }

  if (db.todos.length) {
    await drizzleDb.insert(todos).values(
      db.todos.map((todo) => ({
        id: todo.id,
        title: todo.title ?? "",
        description: todo.description ?? "",
        priority: todo.priority ?? "P2",
        status: todo.status ?? "open",
        created_at: todo.created_at ? new Date(todo.created_at) : null,
        updated_at: todo.updated_at ? new Date(todo.updated_at) : null
      })) as any
    );
  }

  if (db.conversations.length) {
    await drizzleDb.insert(conversations).values(
      db.conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title ?? "",
        status: conversation.status ?? "pending",
        created_at: conversation.created_at
          ? new Date(conversation.created_at)
          : null,
        updated_at: conversation.updated_at
          ? new Date(conversation.updated_at)
          : null,
        messages: conversation.messages ?? [],
        attachments: conversation.attachments ?? null,
        context_customer_ids: conversation.context_customer_ids ?? null,
        ai_outputs: conversation.ai_outputs ?? null,
        linked_customer_id: conversation.linked_customer_id ?? null
      })) as any
    );
  }
}

export async function readDb(): Promise<DbShape> {
  await ensureInitialized();
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await readDbWithClient(client);
  } finally {
    client.release();
  }
}

export async function withDb<T>(
  mutator: (db: DbShape) => Promise<{ db: DbShape; result: T }> | {
    db: DbShape;
    result: T;
  }
) {
  const globalPool = globalThis as GlobalPool;
  if (!globalPool.__ai4sales_write_queue__) {
    globalPool.__ai4sales_write_queue__ = Promise.resolve();
  }
  let result: T | undefined;

  globalPool.__ai4sales_write_queue__ = globalPool.__ai4sales_write_queue__
    .then(async () => {
      await ensureInitialized();
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const db = await readDbWithClient(client);
        const outcome = await mutator(db);
        await writeDbWithClient(client, outcome.db);
        await client.query("COMMIT");
        result = outcome.result;
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("DB write failed", error);
        throw error;
      } finally {
        client.release();
      }
    })
    .catch((error) => {
      console.error("DB write queue failed", error);
      throw error;
    });

  await globalPool.__ai4sales_write_queue__;
  return result as T;
}

export type CustomerListParams = {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  tag?: string;
  hasContact?: boolean;
};

export async function listCustomers(params: CustomerListParams) {
  const {
    page,
    pageSize,
    search,
    sort = "updated_at",
    order = "desc",
    tag,
    hasContact
  } = params;

  return await withClient(async (client) => {
    const db = drizzle(client);
    const conditions = [];
    const term = search?.trim();
    if (term) {
      const like = `%${term}%`;
      conditions.push(
        or(
          ilike(customers.name, like),
          ilike(customers.company, like),
          ilike(customers.title, like),
          ilike(customers.address, like),
          ilike(customers.wechat, like),
          sql`array_to_string(${customers.phones}, ' ') ILIKE ${like}`,
          sql`array_to_string(${customers.emails}, ' ') ILIKE ${like}`,
          sql`array_to_string(${customers.tags}, ' ') ILIKE ${like}`
        )
      );
    }
    if (tag && tag !== "all") {
      conditions.push(
        sql`${customers.tags} @> ARRAY[${tag}]::text[]`
      );
    }
    if (hasContact) {
      conditions.push(
        sql`(coalesce(array_length(${customers.phones}, 1), 0) > 0
          OR coalesce(array_length(${customers.emails}, 1), 0) > 0
          OR coalesce(${customers.wechat}, '') <> '')`
      );
    }
    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(whereExpr);
    const total = Number(totalRows[0]?.count ?? 0);

    const totalCustomersRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers);
    const totalCustomers = Number(totalCustomersRows[0]?.count ?? 0);

    const tagRows = await db.execute(
      sql<{ tag: string }>`SELECT DISTINCT unnest(tags) AS tag FROM customers WHERE tags IS NOT NULL`
    );
    const tagOptions = tagRows.rows
      .map((row) => row.tag)
      .filter(Boolean);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const offset = (safePage - 1) * pageSize;

    const orderColumn =
      sort === "name"
        ? customers.name
        : sort === "created_at"
          ? customers.created_at
          : customers.updated_at;
    const orderBy = order === "asc" ? asc(orderColumn) : desc(orderColumn);

    const rows = await db
      .select()
      .from(customers)
      .where(whereExpr)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows.map(mapCustomerRow),
      meta: {
        page: safePage,
        pageSize,
        total,
        totalPages,
        tagOptions,
        totalCustomers
      }
    };
  });
}

export async function getCustomerById(id: string) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    return rows[0] ? mapCustomerRow(rows[0]) : null;
  });
}

export async function findDuplicateCustomers(name?: string, company?: string) {
  if (!name || !company) return [];
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.name, name), eq(customers.company, company)));
    return rows.map(mapCustomerRow);
  });
}

export async function createCustomer(customer: Customer) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .insert(customers)
      .values({
        id: customer.id,
        name: customer.name ?? null,
        company: customer.company ?? null,
        title: customer.title ?? null,
        phones: customer.phones ?? [],
        emails: customer.emails ?? [],
        wechat: customer.wechat ?? "",
        address: customer.address ?? "",
        tags: customer.tags ?? [],
        profile_markdown: customer.profile_markdown ?? "",
        created_at: customer.created_at ? new Date(customer.created_at) : null,
        updated_at: customer.updated_at ? new Date(customer.updated_at) : null,
        source: customer.source ?? "manual",
        last_verified_at: customer.last_verified_at
          ? new Date(customer.last_verified_at)
          : null
      } as any)
      .returning();
    return rows[0] ? mapCustomerRow(rows[0]) : null;
  });
}

export async function updateCustomer(customer: Customer) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .update(customers)
      .set({
        name: customer.name ?? null,
        company: customer.company ?? null,
        title: customer.title ?? null,
        phones: customer.phones ?? [],
        emails: customer.emails ?? [],
        wechat: customer.wechat ?? "",
        address: customer.address ?? "",
        tags: customer.tags ?? [],
        profile_markdown: customer.profile_markdown ?? "",
        created_at: customer.created_at ? new Date(customer.created_at) : null,
        updated_at: customer.updated_at ? new Date(customer.updated_at) : null,
        source: customer.source ?? "manual",
        last_verified_at: customer.last_verified_at
          ? new Date(customer.last_verified_at)
          : null
      } as any)
      .where(eq(customers.id, customer.id))
      .returning();
    return rows[0] ? mapCustomerRow(rows[0]) : null;
  });
}

export async function deleteCustomer(id: string) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .delete(customers)
      .where(eq(customers.id, id))
      .returning({ id: customers.id });
    return rows.length > 0;
  });
}

export type TodoListParams = {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  status?: string;
  priority?: string;
};

export async function listTodos(params: TodoListParams) {
  const {
    page,
    pageSize,
    search,
    sort = "updated_at",
    order = "desc",
    status,
    priority
  } = params;

  return await withClient(async (client) => {
    const db = drizzle(client);
    const conditions = [];
    const term = search?.trim();
    if (term) {
      const like = `%${term}%`;
      conditions.push(
        or(ilike(todos.title, like), ilike(todos.description, like))
      );
    }
    if (status && status !== "all") {
      conditions.push(eq(todos.status, status));
    }
    if (priority && priority !== "all") {
      conditions.push(eq(todos.priority, priority));
    }
    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(todos)
      .where(whereExpr);
    const total = Number(totalRows[0]?.count ?? 0);

    const statsRows = await db.execute(
      sql<{ open: number; done: number; high: number }>`
        SELECT
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)::int AS open,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS done,
          SUM(CASE WHEN status = 'open' AND priority = 'P0' THEN 1 ELSE 0 END)::int AS high
        FROM todos
      `
    );
    const stats = statsRows.rows[0] ?? { open: 0, done: 0, high: 0 };

    const totalTodosRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(todos);
    const totalTodos = Number(totalTodosRows[0]?.count ?? 0);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const offset = (safePage - 1) * pageSize;

    const priorityOrder = sql`CASE ${todos.priority}
      WHEN 'P0' THEN 0
      WHEN 'P1' THEN 1
      WHEN 'P2' THEN 2
      ELSE 3 END`;
    const orderColumn =
      sort === "priority"
        ? priorityOrder
        : sort === "created_at"
          ? todos.created_at
          : todos.updated_at;
    const orderBy = order === "asc" ? asc(orderColumn) : desc(orderColumn);

    const rows = await db
      .select()
      .from(todos)
      .where(whereExpr)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows.map(mapTodoRow),
      meta: {
        page: safePage,
        pageSize,
        total,
        totalPages,
        stats,
        totalTodos
      }
    };
  });
}

export async function getTodoById(id: string) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .select()
      .from(todos)
      .where(eq(todos.id, id))
      .limit(1);
    return rows[0] ? mapTodoRow(rows[0]) : null;
  });
}

export async function createTodo(todo: Todo) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .insert(todos)
      .values({
        id: todo.id,
        title: todo.title ?? "",
        description: todo.description ?? "",
        priority: todo.priority ?? "P2",
        status: todo.status ?? "open",
        created_at: todo.created_at ? new Date(todo.created_at) : null,
        updated_at: todo.updated_at ? new Date(todo.updated_at) : null
      } as any)
      .returning();
    return rows[0] ? mapTodoRow(rows[0]) : null;
  });
}

export async function updateTodo(todo: Todo) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .update(todos)
      .set({
        title: todo.title ?? "",
        description: todo.description ?? "",
        priority: todo.priority ?? "P2",
        status: todo.status ?? "open",
        created_at: todo.created_at ? new Date(todo.created_at) : null,
        updated_at: todo.updated_at ? new Date(todo.updated_at) : null
      } as any)
      .where(eq(todos.id, todo.id))
      .returning();
    return rows[0] ? mapTodoRow(rows[0]) : null;
  });
}

export async function deleteTodo(id: string) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .delete(todos)
      .where(eq(todos.id, id))
      .returning({ id: todos.id });
    return rows.length > 0;
  });
}

export type ConversationListParams = {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
};

export async function listConversations(params: ConversationListParams) {
  const { page, pageSize, status, search } = params;

  return await withClient(async (client) => {
    const db = drizzle(client);
    const conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(conversations.status, status));
    }
    const term = search?.trim();
    if (term) {
      const like = `%${term}%`;
      conditions.push(ilike(conversations.title, like));
    }
    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(whereExpr);
    const total = Number(totalRows[0]?.count ?? 0);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = await db
      .select()
      .from(conversations)
      .where(whereExpr)
      .orderBy(desc(conversations.updated_at))
      .limit(pageSize)
      .offset(offset);

    return {
      data: rows.map(mapConversationRow),
      meta: { page: safePage, pageSize, total, totalPages }
    };
  });
}

export async function getConversationById(id: string) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return rows[0] ? mapConversationRow(rows[0]) : null;
  });
}

export async function getConversationByCustomerId(customerId: string) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.linked_customer_id, customerId))
      .orderBy(desc(conversations.updated_at))
      .limit(1);
    return rows[0] ? mapConversationRow(rows[0]) : null;
  });
}

export async function createConversation(conversation: Conversation) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .insert(conversations)
      .values({
        id: conversation.id,
        title: conversation.title ?? "",
        status: conversation.status ?? "pending",
        created_at: conversation.created_at
          ? new Date(conversation.created_at)
          : null,
        updated_at: conversation.updated_at
          ? new Date(conversation.updated_at)
          : null,
        messages: conversation.messages ?? [],
        attachments: conversation.attachments ?? null,
        context_customer_ids: conversation.context_customer_ids ?? null,
        ai_outputs: conversation.ai_outputs ?? null,
        linked_customer_id: conversation.linked_customer_id ?? null,
        claude_session_id: conversation.claude_session_id ?? null
      } as any)
      .returning();
    return rows[0] ? mapConversationRow(rows[0]) : null;
  });
}

export async function updateConversation(conversation: Conversation) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .update(conversations)
      .set({
        title: conversation.title ?? "",
        status: conversation.status ?? "pending",
        created_at: conversation.created_at
          ? new Date(conversation.created_at)
          : null,
        updated_at: conversation.updated_at
          ? new Date(conversation.updated_at)
          : null,
        messages: conversation.messages ?? [],
        attachments: conversation.attachments ?? null,
        context_customer_ids: conversation.context_customer_ids ?? null,
        ai_outputs: conversation.ai_outputs ?? null,
        linked_customer_id: conversation.linked_customer_id ?? null,
        claude_session_id: conversation.claude_session_id ?? null
      } as any)
      .where(eq(conversations.id, conversation.id))
      .returning();
    return rows[0] ? mapConversationRow(rows[0]) : null;
  });
}

export async function updateConversationLink(
  id: string,
  updates: Partial<Pick<Conversation, "status" | "linked_customer_id" | "ai_outputs" | "updated_at">>
) {
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db
      .update(conversations)
      .set({
        status: updates.status ?? undefined,
        linked_customer_id: updates.linked_customer_id ?? undefined,
        ai_outputs: updates.ai_outputs ?? undefined,
        updated_at: updates.updated_at
          ? new Date(updates.updated_at)
          : undefined
      } as any)
      .where(eq(conversations.id, id))
      .returning();
    return rows[0] ? mapConversationRow(rows[0]) : null;
  });
}

export async function createCustomerWithConversationLink(
  customer: Customer,
  conversationId?: string
) {
  return await withTransaction(async (db) => {
    const [inserted] = await db
      .insert(customers)
      .values({
        id: customer.id,
        name: customer.name ?? null,
        company: customer.company ?? null,
        title: customer.title ?? null,
        phones: customer.phones ?? [],
        emails: customer.emails ?? [],
        wechat: customer.wechat ?? "",
        address: customer.address ?? "",
        tags: customer.tags ?? [],
        profile_markdown: customer.profile_markdown ?? "",
        created_at: customer.created_at ? new Date(customer.created_at) : null,
        updated_at: customer.updated_at ? new Date(customer.updated_at) : null,
        source: customer.source ?? "manual",
        last_verified_at: customer.last_verified_at
          ? new Date(customer.last_verified_at)
          : null
      } as any)
      .returning();

    if (conversationId) {
      await db
        .update(conversations)
        .set({
          status: "confirmed",
          linked_customer_id: customer.id,
          updated_at: new Date(customer.updated_at)
        } as any)
        .where(eq(conversations.id, conversationId));
    }

    return inserted ? mapCustomerRow(inserted) : null;
  });
}

// ==================== System Configs ====================

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  id: "default",
  system_prompt: "You are a concise and practical AI sales assistant.",
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
  theme: "system",
  workspace_enabled: true,
  extras: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function mapSystemConfigRow(row: typeof systemConfigs.$inferSelect): SystemConfig {
  return {
    id: row.id,
    system_prompt: row.system_prompt ?? DEFAULT_SYSTEM_CONFIG.system_prompt,
    model: row.model ?? DEFAULT_SYSTEM_CONFIG.model,
    provider: row.provider ?? DEFAULT_SYSTEM_CONFIG.provider,
    theme: (row.theme ?? DEFAULT_SYSTEM_CONFIG.theme) as SystemConfig["theme"],
    workspace_enabled: row.workspace_enabled ?? true,
    extras: parseJson<Record<string, unknown>>(row.extras),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

/**
 * Get the singleton system config. Returns defaults if none exists.
 */
export async function getSystemConfig(): Promise<SystemConfig> {
  await ensureInitialized();
  return await withClient(async (client) => {
    const db = drizzle(client);
    const rows = await db.select().from(systemConfigs).where(eq(systemConfigs.id, "default"));
    if (rows.length === 0) return { ...DEFAULT_SYSTEM_CONFIG };
    return mapSystemConfigRow(rows[0]);
  });
}

/**
 * Upsert the singleton system config.
 */
export async function upsertSystemConfig(config: Partial<SystemConfig>): Promise<SystemConfig> {
  await ensureInitialized();
  return await withClient(async (client) => {
    const db = drizzle(client);
    const now = new Date();
    const values = {
      id: "default",
      system_prompt: config.system_prompt ?? DEFAULT_SYSTEM_CONFIG.system_prompt,
      model: config.model ?? DEFAULT_SYSTEM_CONFIG.model,
      provider: config.provider ?? DEFAULT_SYSTEM_CONFIG.provider,
      theme: config.theme ?? DEFAULT_SYSTEM_CONFIG.theme,
      workspace_enabled: config.workspace_enabled ?? true,
      extras: config.extras ?? {},
      created_at: now,
      updated_at: now,
    } as any;

    const [row] = await db
      .insert(systemConfigs)
      .values(values)
      .onConflictDoUpdate({
        target: systemConfigs.id,
        set: {
          system_prompt: config.system_prompt,
          model: config.model,
          provider: config.provider,
          theme: config.theme,
          workspace_enabled: config.workspace_enabled,
          extras: config.extras,
          updated_at: now,
        } as any,
      })
      .returning();

    return row ? mapSystemConfigRow(row) : { ...DEFAULT_SYSTEM_CONFIG };
  });
}
