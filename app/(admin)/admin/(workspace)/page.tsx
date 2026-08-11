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
    <div className="space-y-12">
      <AdminPageHeader eyebrow="" title="运营总览" description="" />
      <DashboardMetrics />
      <section>
        <h2 className="font-display text-2xl font-semibold tracking-[-0.03em]">运营动作</h2>
        <div className="mt-6 grid gap-x-12 gap-y-3 sm:grid-cols-2">
          {queues.map((queue) => (
              <Link key={queue.href} href={queue.href} className="group grid min-h-24 grid-cols-[1fr_auto] items-center gap-4 py-4">
                <span><span className="block text-sm font-semibold group-hover:underline">{queue.label}</span><span className="mt-2 block text-xs text-text-tertiary">{queue.detail}</span></span>
                <span aria-hidden="true" className="text-text-tertiary">→</span>
              </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
