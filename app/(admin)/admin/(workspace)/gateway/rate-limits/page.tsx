import Link from "next/link";
import AdminModulePage, {
  gatewayTabs,
} from "@/components/admin/AdminModulePage";
import AdminResourceTable from "@/components/admin/AdminResourceTable";
import {
  GatewayUserDefaultLimitsView,
  ModelPermissionsResourceView,
} from "@/components/admin/AdminResourceViews";

const policySources = [
  {
    title: "用户默认 Token 上限",
    detail: "可编辑每日／每月 Token，适用于该用户的所有模型。",
  },
  {
    title: "用户—模型例外限制",
    detail: "仅在需要单独禁用或收紧某个用户对某个模型的 Token 上限时配置。",
  },
  {
    title: "套餐权益提示",
    detail:
      "套餐版本中的模型与 Token 权益在订阅中心维护；此处提示其同样参与最终最小值计算。",
    href: "/admin/subscriptions/entitlements",
    linkLabel: "前往套餐权益",
  },
  {
    title: "实时用量窗口",
    detail:
      "系统自动累加的分钟／日／月运行事实；只读，不允许篡改或清零。",
  },
];

export default function GatewayRateLimitsPage() {
  return (
    <AdminModulePage
      eyebrow="Proxy gateway / rate limits"
      title="限流策略"
      description="在可编辑策略区调整用户、模型和套餐上限；实时窗口只记录已经发生的请求与 Token 用量。"
      status="策略可编辑 · 计数只读"
      tabs={gatewayTabs}
    >
      <section
        className="admin-panel p-5"
        aria-labelledby="rate-limit-data-model-title"
      >
        <h2
          id="rate-limit-data-model-title"
          className="font-display text-xl font-semibold"
        >
          上限策略与实时计数不是同一类数据
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">
          Gateway 将当前用量与所有适用上限比较，实际生效上限取用户默认、用户—模型覆盖和订阅套餐权益中的最小值。提高一个上限后，如果另一个来源更低，429
          仍会继续出现。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {policySources.map((item) => (
            <div
              key={item.title}
              className="border border-border bg-bg-secondary/45 p-4"
            >
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="mt-2 text-xs leading-5 text-text-tertiary">
                {item.detail}
              </p>
              {item.href ? (
                <Link
                  href={item.href}
                  className="mt-3 inline-flex min-h-10 items-center border border-border bg-bg-surface px-3 text-xs font-semibold text-text-primary"
                >
                  {item.linkLabel}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <GatewayUserDefaultLimitsView />
      <ModelPermissionsResourceView />
      <AdminResourceTable
        resource="gateway-rate-limits"
        title="实时用量计数（只读）"
        description="Gateway 按用户、模型和分钟／日／月窗口自动累加请求与 Token。该区域不是配置策略，不提供编辑或清零；修改上限请使用上方策略区。"
        defaultSort="window_start"
        filters={[
          { field: "email", label: "用户邮箱" },
          { field: "model_code", label: "模型" },
          {
            field: "window_type",
            label: "窗口",
            operator: "eq",
          },
        ]}
        columns={[
          { key: "email", label: "用户" },
          { key: "model_code", label: "模型" },
          { key: "window_type", label: "窗口", format: "status" },
          { key: "window_start", label: "窗口开始", format: "date" },
          { key: "request_count", label: "请求数" },
          { key: "token_count", label: "Token" },
          { key: "updated_at", label: "更新时间", format: "date" },
        ]}
      />
    </AdminModulePage>
  );
}
