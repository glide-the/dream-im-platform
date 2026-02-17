/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * NOTE: Query key parameters use Record<string, any> for flexibility with API filters.
 * The actual values are type-safe through TypeScript's type inference.
 */
"use client";

import { useMutation, useQuery, useQueryClient, UseQueryOptions } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type { Customer, Todo, Conversation, SystemConfig } from "./types";

// Query keys
export const queryKeys = {
  todos: (params: Record<string, any> = {}) => ["todos", params] as const,
  todo: (id: string) => ["todo", id] as const,
  customers: (params: Record<string, any> = {}) => ["customers", params] as const,
  customer: (id: string) => ["customer", id] as const,
  conversations: (params: Record<string, any> = {}) => ["conversations", params] as const,
  conversation: (id: string) => ["conversation", id] as const,
  searchCustomer: (query: string, contextCustomerIds: string[] = []) =>
    ["searchCustomer", query, contextCustomerIds] as const,
  systemConfig: () => ["systemConfig"] as const,
} as const;

// API Response types
export type ApiResponse<T> = { data: T };
export type ApiListResponse<T> = {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    stats?: { open: number; done: number };
  };
};

type TodoListParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  status?: string;
  priority?: string;
};

type CustomerListParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  tag?: string;
  hasContact?: boolean;
};

type ConversationListParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
};

// ==================== Todos ====================

export function useTodos(params: TodoListParams = {}, options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>) {
  const queryString = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  return useQuery({
    queryKey: queryKeys.todos(params),
    queryFn: () => apiRequest<{ data: Todo[]; meta: any }>(`/api/todos?${queryString}`),
    ...options,
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Todo, "id" | "created_at" | "updated_at">) =>
      apiRequest("/api/todos", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Todo> }) =>
      apiRequest(`/api/todos/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/todos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

// ==================== Customers ====================

export function useCustomers(params: CustomerListParams = {}, options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>) {
  const queryParams: Record<string, string> = {};
  if (params.page !== undefined) queryParams.page = String(params.page);
  if (params.pageSize !== undefined) queryParams.pageSize = String(params.pageSize);
  if (params.search !== undefined) queryParams.search = params.search;
  if (params.sort !== undefined) queryParams.sort = params.sort;
  if (params.order !== undefined) queryParams.order = params.order;
  if (params.tag !== undefined) queryParams.tag = params.tag;
  if (params.hasContact === true) queryParams.hasContact = "1";

  const queryString = new URLSearchParams(queryParams).toString();

  return useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () => apiRequest<{ data: Customer[]; meta: any }>(`/api/customers?${queryString}`),
    ...options,
  });
}

export function useCustomer(id: string, options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.customer(id),
    queryFn: () => apiRequest<{ data: Customer }>(`/api/customers/${id}`),
    enabled: !!id,
    ...options,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<Customer> & { conversation_id?: string }) =>
      apiRequest<ApiResponse<{ id: string }>>("/api/customers", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Customer> }) =>
      apiRequest(`/api/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", variables.id] });
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

// ==================== Conversations ====================

export function useConversations(params: ConversationListParams = {}, options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>) {
  const queryString = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  return useQuery({
    queryKey: queryKeys.conversations(params),
    queryFn: () => apiRequest<{ data: Conversation[]; meta: any }>(`/api/conversations?${queryString}`),
    ...options,
  });
}

export function useConversationByCustomer(customerId: string, options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: ["conversation", "by-customer", customerId] as const,
    queryFn: () => apiRequest<{ data: Conversation | null }>(`/api/conversations/by-customer/${customerId}`),
    enabled: !!customerId,
    ...options,
  });
}

export function useUpdateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Conversation> }) =>
      apiRequest(`/api/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

// ==================== AI Search Customer ====================

export function useSearchCustomer() {
  return useMutation({
    mutationFn: (data: {
      query_text: string;
      attachments?: Array<{ name: string; type: string; size: number }>;
      context_customer_ids?: string[];
    }) =>
      apiRequest<{
        conversation_id: string;
        customer_card: {
          structured_fields: Partial<Customer>;
          profile_markdown: string;
          confidence?: number;
          sources?: { label: string; url?: string }[];
        };
        action_suggestions: string[];
      }>("/api/agent/search-customer", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: async () => {
      // Refresh conversations after search
      // Will be handled by the component
    },
  });
}

// ==================== System Config ====================

export function useSystemConfig(options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>) {
  return useQuery({
    queryKey: queryKeys.systemConfig(),
    queryFn: () => apiRequest<{ data: SystemConfig }>("/api/system-config"),
    staleTime: 1000 * 60 * 10, // 10 minutes — config changes rarely
    ...options,
  });
}

export function useUpdateSystemConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<SystemConfig>) =>
      apiRequest<{ data: SystemConfig }>("/api/system-config", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.systemConfig() });
    },
  });
}
