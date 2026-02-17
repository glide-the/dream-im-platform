export type CustomerSource = "ai_search" | "manual" | "import";

export type DecisionChainItem = {
  name: string;
  contacts?: {
    phones?: string[];
    emails?: string[];
    wechat?: string;
  };
  age?: string;
  personality?: string;
  preferences?: string;
  role_in_chain?: string;
};

export type Customer = {
  id: string;
  name?: string;
  company?: string;
  title?: string;
  phones?: string[];
  emails?: string[];
  wechat?: string;
  address?: string;
  tags?: string[];
  decision_chain?: DecisionChainItem[];
  profile_markdown?: string;
  created_at: string;
  updated_at: string;
  source: CustomerSource;
  last_verified_at?: string;
};

export type TodoPriority = "P0" | "P1" | "P2" | "P3";
export type TodoStatus = "open" | "done";

export type Todo = {
  id: string;
  title: string;
  description?: string;
  priority: TodoPriority;
  status: TodoStatus;
  created_at: string;
  updated_at: string;
};

export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
};

// Message part types for storing rich message content (aligned with AI SDK UIMessage format)
// Reference: cgoinglove/better-chatbot convertToSavePart pattern
// Note: We preserve the original type field as streamed (e.g., "tool-search", "dynamic-tool")
// to allow faithful restoration when loading from database.

export type TextMessagePart = {
  type: "text";
  text: string;
  state?: "done" | "streaming";
};

export type ReasoningMessagePart = {
  type: "reasoning";
  text: string;
  state?: "done" | "streaming";
};

export type StepStartMessagePart = {
  type: "step-start";
};

// Tool type pattern: "tool", "dynamic-tool", or "tool-{toolName}"
export type ToolType = "tool" | "dynamic-tool" | `tool-${string}`;

// Tool message part - preserves original type from AI SDK stream
// The type can be "tool-{toolName}", "dynamic-tool", or legacy "tool"
export type ToolMessagePart = {
  type: ToolType; // Preserves original: "tool-{name}", "dynamic-tool", or "tool"
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  state: "input-available" | "input-streaming" | "output-available" | "output-error" | "error" | "done";
  // Extended parameters from AI SDK
  title?: string;
  providerExecuted?: boolean;
};

export type FileMessagePart = {
  type: "file";
  url: string;
  mediaType?: string;
  filename?: string;
};

export type SourceUrlMessagePart = {
  type: "source-url";
  url: string;
  mediaType?: string;
  title?: string;
};

export type WorkspaceFilePathMessagePart = {
  type: "workspace-file";
  fileName: string;
  mimeType: string;
  size: number;
  workspacePath: string;
  savedAt: string;
  hash?: string;
};

// Generic part for any other unknown types - preserves raw data
export type GenericMessagePart = {
  type: string;
  [key: string]: unknown;
};

// Union type for all supported message parts
export type MessagePart =
  | TextMessagePart
  | ReasoningMessagePart
  | StepStartMessagePart
  | ToolMessagePart
  | FileMessagePart
  | SourceUrlMessagePart
  | WorkspaceFilePathMessagePart
  | GenericMessagePart;

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: MessagePart[];  // Optional parts array for rich message content
  created_at: string;
};

export type CustomerCard = {
  structured_fields: {
    name?: string;
    company?: string;
    title?: string;
    phones?: string[];
    emails?: string[];
    wechat?: string;
    address?: string;
    tags?: string[];
    decision_chain?: DecisionChainItem[];
  };
  profile_markdown: string;
  confidence?: number;
  sources?: { label: string; url?: string }[];
};

export type Conversation = {
  id: string;
  title: string;
  status: "pending" | "confirmed" | "canceled";
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
  attachments?: Attachment[];
  context_customer_ids?: string[];
  ai_outputs?: {
    customer_card?: CustomerCard;
  };
  linked_customer_id?: string;
  /** Claude SDK session_id for resuming conversations */
  claude_session_id?: string;
};

export type ThemeMode = "light" | "dark" | "system";

export type SystemConfig = {
  id: string;
  /** System prompt sent to the agent */
  system_prompt: string;
  /** Model identifier, e.g. "claude-sonnet-4-20250514" */
  model: string;
  /** Model provider, e.g. "anthropic" */
  provider: string;
  /** Theme preference */
  theme: ThemeMode;
  /** Whether workspace file access is enabled */
  workspace_enabled: boolean;
  /** Extra settings (future-proof) */
  extras?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DbShape = {
  customers: Customer[];
  todos: Todo[];
  conversations: Conversation[];
};
