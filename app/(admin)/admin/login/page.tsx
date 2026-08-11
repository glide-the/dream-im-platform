import AdminAuthEntry from "./AdminAuthEntry";

export default function AdminLoginPage() {
  return (
    <main className="min-h-[100dvh] bg-bg-surface text-text-primary lg:grid lg:grid-cols-[minmax(0,1.32fr)_minmax(420px,0.68fr)]">
      <section className="relative hidden min-h-[100dvh] bg-[#151a2b] px-20 py-16 lg:flex lg:items-center xl:px-28">
        <div>
          <h1 className="font-display text-[clamp(7rem,10vw,12rem)] font-semibold leading-[0.86] tracking-[-0.075em] text-[#f7f7f4]">
            Ink
            <br />
            <span className="text-[#aebff2]">Memory</span>
          </h1>
          <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.32em] text-[#808ba8]">运营控制台</p>
        </div>
      </section>

      <section className="flex min-h-[100dvh] flex-col bg-bg-surface px-5 py-8 sm:px-10 lg:px-12 xl:px-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.04em] text-text-primary lg:hidden">
          Ink Memory
        </h1>

        <div className="mx-auto flex w-full max-w-[390px] flex-1 items-center py-20">
          <div className="w-full" role="region" aria-label="Ink Memory 管理入口">
            <AdminAuthEntry />
          </div>
        </div>
      </section>
    </main>
  );
}
