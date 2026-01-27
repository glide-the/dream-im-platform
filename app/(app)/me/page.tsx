"use client";

import { useEffect, useState } from "react";
import { IconChevronRight, IconSettings } from "../../components/Icons";
import { apiRequest } from "../../lib/client";

const settings = [
  "账号信息",
  "语言设置",
  "数据导出",
  "隐私与协议",
  "反馈与建议"
];

export default function MePage() {
  const [stats, setStats] = useState({ customers: 0, todos: 0 });

  useEffect(() => {
    Promise.all([
      apiRequest<{ meta: { totalCustomers: number } }>("/api/customers"),
      apiRequest<{ meta: { totalTodos: number } }>("/api/todos")
    ])
      .then(([customers, todos]) => {
        setStats({
          customers: customers.meta.totalCustomers,
          todos: todos.meta.totalTodos
        });
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-[32px] bg-bg-primary p-6 shadow-subtle md:rounded-[40px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-[var(--color-bg-secondary)] to-[var(--color-bg-primary)]" />
      <div className="pointer-events-none absolute -right-12 top-6 h-44 w-44 rounded-full bg-[radial-gradient(circle,_var(--color-accent-light),_transparent_70%)]" />

      <div className="relative">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-text-primary">
            我的
          </h1>
          <button className="grid h-9 w-9 place-items-center rounded-full border border-border bg-bg-surface text-text-secondary">
            <IconSettings className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-bg-surface p-4 shadow-subtle">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-accent-light" />
            <div>
              <p className="text-base font-semibold text-text-primary">王珊</p>
              <p className="text-xs text-text-secondary">大客户经理 · 华东区</p>
              <p className="text-xs text-text-tertiary">锐智科技有限公司</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              { label: "客户", value: stats.customers },
              { label: "待办", value: stats.todos }
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl bg-bg-secondary px-3 py-2 text-center text-xs font-semibold text-text-secondary"
              >
                {stat.label} {stat.value}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {settings.map((item) => (
            <button
              key={item}
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-bg-surface px-4 py-3 text-sm font-medium text-text-primary"
            >
              <span>{item}</span>
              <IconChevronRight className="h-4 w-4 text-text-tertiary" />
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
