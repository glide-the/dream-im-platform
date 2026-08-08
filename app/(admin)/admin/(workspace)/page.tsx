import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import DashboardMetrics from "@/components/admin/DashboardMetrics";

const queues = [
  { label: "审核真实剧本数据", detail: "用户 → 工作区 → 剧本", href: "/admin/story/stories" },
  { label: "维护平台用户状态", detail: "用户状态 → 关联工作区 → 关联剧本", href: "/admin/resources/users" },
  { label: "治理文件资源", detail: "Storage 配置 → 文件 → 审计", href: "/admin/resources/storage" },
  { label: "检查权限与审计", detail: "管理员 → 角色 → 权限 → 操作记录", href: "/admin/access/admins" },
];

export default function AdminOverviewPage() {
  return (
    <div className="space-y-7">
      <AdminPageHeader eyebrow="Operations overview" title="运营总览" description="把需要处置的审核、模型和资源问题以及只读网关记录放在同一工作台。这里不展示装饰性指标，所有数字均可追溯到真实资源。" status="PostgreSQL · protected" />
      <DashboardMetrics />
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="admin-panel p-5 sm:p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Operational queues</p>
          <h2 className="mt-2 font-display text-xl font-semibold">下一步运营动作</h2>
          <div className="mt-5 divide-y divide-border border-y border-border">
            {queues.map((queue, index) => (
              <Link key={queue.href} href={queue.href} className="group grid min-h-20 grid-cols-[34px_1fr_auto] items-center gap-3 py-4">
                <span className="font-mono text-[10px] text-text-tertiary">0{index + 1}</span>
                <span><span className="block text-sm font-semibold group-hover:underline">{queue.label}</span><span className="mt-1 block text-xs text-text-tertiary">{queue.detail}</span></span>
                <span aria-hidden="true" className="text-text-tertiary">→</span>
              </Link>
            ))}
          </div>
        </div>
        <aside className="admin-panel p-5 sm:p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Data boundaries</p>
          <h2 className="mt-2 font-display text-xl font-semibold">数据源边界</h2>
          <dl className="mt-5 divide-y divide-border border-y border-border text-sm">
            <div className="py-4"><dt className="font-semibold">业务数据</dt><dd className="mt-1 leading-6 text-text-secondary">真实 `users` 与 `story_workspace_*` 表，经同一个 PostgreSQL 连接读取。</dd></div>
            <div className="py-4"><dt className="font-semibold">控制面数据</dt><dd className="mt-1 leading-6 text-text-secondary">RBAC、Provider、Pricing、Billing、Gateway 与审计由 Admin PostgreSQL 管理。</dd></div>
            <div className="py-4"><dt className="font-semibold">不可变数据</dt><dd className="mt-1 leading-6 text-text-secondary">Token 账本、用量与审计禁止覆盖或硬删除。</dd></div>
          </dl>
        </aside>
      </section>
    </div>
  );
}
