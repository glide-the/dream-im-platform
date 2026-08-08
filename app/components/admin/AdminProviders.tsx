"use client";

import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  adminAccessControlProvider,
  adminAuthProvider,
  adminDataProvider,
} from "./providers";

const resources = [
  {
    name: "platform-users",
    list: "/admin/users",
    meta: { label: "平台用户" },
  },
  {
    name: "user-model-permissions",
    list: "/admin/users",
    meta: { label: "用户模型权限" },
  },
  {
    name: "story-workspaces",
    list: "/admin/story",
    meta: { label: "创作空间" },
  },
  {
    name: "story-projects",
    list: "/admin/story",
    meta: { label: "剧本数据" },
  },
  {
    name: "story-characters",
    list: "/admin/story",
    meta: { label: "角色数据" },
  },
  {
    name: "story-scenes",
    list: "/admin/story",
    meta: { label: "场景数据" },
  },
  {
    name: "story-workflow-runs",
    list: "/admin/story",
    meta: { label: "工作流运行" },
  },
  {
    name: "models",
    list: "/admin/models",
    meta: { label: "模型中心" },
  },
  {
    name: "providers",
    list: "/admin/models",
    meta: { label: "模型供应商" },
  },
  {
    name: "pricing-rules",
    list: "/admin/models",
    meta: { label: "模型定价" },
  },
  {
    name: "billing-accounts",
    list: "/admin/billing",
    meta: { label: "计费账户" },
  },
  {
    name: "usage",
    list: "/admin/billing",
    meta: { label: "Token 计费" },
  },
  {
    name: "ledger",
    list: "/admin/billing",
    meta: { label: "计费账本" },
  },
  {
    name: "gateway-requests",
    list: "/admin/gateway",
    meta: { label: "代理网关" },
  },
  {
    name: "gateway-api-keys",
    list: "/admin/users",
    meta: { label: "网关密钥" },
  },
  {
    name: "gateway-rate-limits",
    list: "/admin/gateway",
    meta: { label: "网关限流窗口" },
  },
  {
    name: "admin-users",
    list: "/admin/access",
    meta: { label: "权限管理" },
  },
  {
    name: "admin-roles",
    list: "/admin/access",
    meta: { label: "管理员角色" },
  },
  {
    name: "admin-permissions",
    list: "/admin/access",
    meta: { label: "权限代码" },
  },
  {
    name: "system-settings",
    list: "/admin/system",
    meta: { label: "系统设置" },
  },
  {
    name: "audit-logs",
    list: "/admin/audit",
    meta: { label: "审计日志" },
  },
];

export default function AdminProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  return (
    <Refine
      routerProvider={routerProvider}
      resources={resources}
      dataProvider={adminDataProvider}
      authProvider={adminAuthProvider}
      accessControlProvider={adminAccessControlProvider}
      options={{
        disableTelemetry: true,
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
        reactQuery: {
          clientConfig: queryClient,
        },
      }}
    >
      {children}
    </Refine>
  );
}
