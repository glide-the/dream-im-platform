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

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
};

export type DbShape = {
  customers: Customer[];
  todos: Todo[];
  conversations: Conversation[];
};
