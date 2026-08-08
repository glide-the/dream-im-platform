import Link from "next/link";

export default function AdminPageHeader({
  eyebrow,
  title,
  description,
  breadcrumb,
  status,
}: {
  eyebrow: string;
  title: string;
  description: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  status?: string;
}) {
  return (
    <header className="border-b border-border pb-6">
      {breadcrumb?.length ? (
        <nav aria-label="面包屑" className="mb-5 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          {breadcrumb.map((item, index) => (
            <span key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index ? <span aria-hidden="true">/</span> : null}
              {item.href ? <Link href={item.href} className="underline decoration-border hover:text-text-primary">{item.label}</Link> : <span aria-current="page">{item.label}</span>}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-tertiary">{eyebrow}</p>
          <h1 className="mt-2 font-display text-[clamp(1.75rem,4vw,2.7rem)] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">{description}</p>
        </div>
        {status ? <span className="border border-border bg-bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">{status}</span> : null}
      </div>
    </header>
  );
}
