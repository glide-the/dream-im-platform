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
    name: "users",
    list: "/admin/resources/users",
    meta: { label: "平台用户" },
  },
  {
    name: "source-users",
    list: "/admin/resources/users",
    meta: { label: "业务用户" },
  },
  {
    name: "platform-users",
    list: "/admin/resources/users",
    meta: { label: "计费用户映射" },
  },
  {
    name: "user-model-permissions",
    list: "/admin/models/permissions",
    meta: { label: "用户模型权限" },
  },
  {
    name: "story-workspaces",
    list: "/admin/story/workspaces",
    meta: { label: "创作空间" },
  },
  {
    name: "story-stories",
    list: "/admin/story/stories",
    meta: { label: "剧本数据" },
  },
  {
    name: "stories",
    list: "/admin/story/stories",
    meta: { label: "剧本" },
  },
  {
    name: "story-characters",
    list: "/admin/story/characters",
    meta: { label: "角色数据" },
  },
  {
    name: "story-scenes",
    list: "/admin/story/scenes",
    meta: { label: "场景数据" },
  },
  {
    name: "models",
    list: "/admin/models/models",
    create: "/admin/models/models/new",
    edit: "/admin/models/models/:id/edit",
    meta: { label: "模型中心" },
  },
  {
    name: "providers",
    list: "/admin/models/providers",
    create: "/admin/models/providers/new",
    edit: "/admin/models/providers/:id/edit",
    meta: { label: "模型供应商" },
  },
  {
    name: "pricing-rules",
    list: "/admin/models/pricing",
    create: "/admin/models/pricing/new",
    meta: { label: "模型定价" },
  },
  {
    name: "billing-accounts",
    list: "/admin/billing/accounts",
    meta: { label: "计费账户" },
  },
  {
    name: "subscription-plans",
    list: "/admin/subscriptions/plans",
    meta: { label: "订阅套餐" },
  },
  {
    name: "subscription-plan-versions",
    list: "/admin/subscriptions/versions",
    meta: { label: "套餐版本" },
  },
  {
    name: "subscription-entitlements",
    list: "/admin/subscriptions/entitlements",
    meta: { label: "套餐权益" },
  },
  {
    name: "subscriptions",
    list: "/admin/subscriptions/users",
    meta: { label: "用户订阅" },
  },
  {
    name: "subscription-allowances",
    list: "/admin/subscriptions/users",
    meta: { label: "周期额度" },
  },
  {
    name: "subscription-events",
    list: "/admin/subscriptions/users",
    meta: { label: "订阅事件" },
  },
  {
    name: "usage",
    list: "/admin/billing/usage",
    meta: { label: "Token 计费" },
  },
  {
    name: "ledger",
    list: "/admin/billing/ledger",
    meta: { label: "计费账本" },
  },
  {
    name: "gateway-requests",
    list: "/admin/gateway/requests",
    meta: { label: "代理网关" },
  },
  {
    name: "gateway-api-keys",
    list: "/admin/gateway/keys",
    meta: { label: "网关密钥" },
  },
  {
    name: "gateway-rate-limits",
    list: "/admin/gateway/rate-limits",
    meta: { label: "网关限流窗口" },
  },
  {
    name: "admin-users",
    list: "/admin/access/admins",
    meta: { label: "权限管理" },
  },
  {
    name: "admin-roles",
    list: "/admin/access/roles",
    meta: { label: "管理员角色" },
  },
  {
    name: "roles",
    list: "/admin/access/roles",
    meta: { label: "角色" },
  },
  {
    name: "admin-permissions",
    list: "/admin/access/permissions",
    meta: { label: "权限代码" },
  },
  {
    name: "permissions",
    list: "/admin/access/permissions",
    meta: { label: "权限" },
  },
  {
    name: "storage-resources",
    list: "/admin/resources/storage",
    meta: { label: "文件存储" },
  },
  {
    name: "system-settings",
    list: "/admin/system/settings",
    meta: { label: "系统设置" },
  },
  {
    name: "audit-logs",
    list: "/admin/system/audit",
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
