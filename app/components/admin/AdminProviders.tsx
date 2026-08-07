"use client";

import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import { useQueryClient } from "@tanstack/react-query";

const resources = [
  {
    name: "admin-home",
    list: "/admin",
    meta: { label: "控制台概览" },
  },
  {
    name: "compatibility",
    show: "/admin/compatibility/:id",
    meta: { label: "兼容性探针" },
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
