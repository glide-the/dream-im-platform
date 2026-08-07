"use client";

import { useGo } from "@refinedev/core";

export default function CompatibilityProbeButton() {
  const go = useGo();

  return (
    <button
      type="button"
      data-testid="refine-route-probe"
      onClick={() =>
        go({
          to: "/admin/compatibility/route-shell",
          type: "push",
        })
      }
      className="inline-flex min-h-11 items-center justify-center gap-3 rounded-full bg-text-primary px-5 py-3 text-sm font-semibold text-bg-surface shadow-subtle transition-transform hover:-translate-y-0.5 hover:shadow-medium motion-reduce:transform-none"
    >
      运行动态路由探针
      <span aria-hidden="true">→</span>
    </button>
  );
}
