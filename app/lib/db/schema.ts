import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { Conversation, DecisionChainItem, SystemConfig } from "../types";

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name"),
  company: text("company"),
  title: text("title"),
  phones: text("phones").array(),
  emails: text("emails").array(),
  wechat: text("wechat"),
  address: text("address"),
  tags: text("tags").array(),
  decision_chain: jsonb("decision_chain").$type<DecisionChainItem[]>(),
  profile_markdown: text("profile_markdown"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  source: text("source"),
  last_verified_at: timestamp("last_verified_at", {
    withTimezone: true,
    mode: "date"
  })
});

export const todos = pgTable("todos", {
  id: text("id").primaryKey(),
  title: text("title"),
  description: text("description"),
  priority: text("priority"),
  status: text("status"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  status: text("status"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  messages: jsonb("messages").$type<Conversation["messages"]>(),
  attachments: jsonb("attachments").$type<Conversation["attachments"]>(),
  context_customer_ids: text("context_customer_ids").array(),
  ai_outputs: jsonb("ai_outputs").$type<Conversation["ai_outputs"]>(),
  linked_customer_id: text("linked_customer_id"),
  /** Claude SDK session_id for resuming conversations */
  claude_session_id: text("claude_session_id")
});

export const systemConfigs = pgTable("system_configs", {
  /** Singleton row — use "default" as the primary key */
  id: text("id").primaryKey().default("default"),
  /** System prompt sent to the agent */
  system_prompt: text("system_prompt"),
  /** Model identifier, e.g. "claude-sonnet-4-20250514" */
  model: text("model"),
  /** Model provider, e.g. "anthropic" */
  provider: text("provider"),
  /** Theme preference: "light" | "dark" | "system" */
  theme: text("theme"),
  /** Whether workspace file access is enabled */
  workspace_enabled: boolean("workspace_enabled").default(true),
  /** Extra settings (future-proof) */
  extras: jsonb("extras").$type<SystemConfig["extras"]>(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});
