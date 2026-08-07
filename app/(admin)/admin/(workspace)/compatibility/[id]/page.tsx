import Link from "next/link";

export default async function AdminCompatibilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="animate-fadeUp">
      <header className="border-b border-border pb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-tertiary">
          Compatibility / dynamic route
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-text-primary sm:text-4xl">
          动态路由已解析
        </h1>
      </header>

      <section className="grid min-h-[55vh] place-items-center py-12">
        <div className="w-full max-w-2xl rounded-[32px] border border-border bg-bg-surface p-6 shadow-medium sm:p-9">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-success-light text-success" aria-hidden="true">
              ✓
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">Next `[id]` 与 Refine `:id` 已连通</p>
              <p className="mt-1 text-xs text-text-tertiary">客户端导航没有离开 `/admin` 命名空间。</p>
            </div>
          </div>

          <dl className="mt-8 rounded-2xl bg-bg-secondary p-4 sm:grid sm:grid-cols-[150px_1fr] sm:gap-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Resolved id</dt>
            <dd className="mt-2 break-all font-mono text-sm font-semibold text-text-primary sm:mt-0" data-testid="compatibility-route-id">
              {id}
            </dd>
          </dl>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-text-primary px-5 py-3 text-sm font-semibold text-bg-surface"
            >
              返回控制台
            </Link>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-success">
              probe passed
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
