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
    <header className="border-b border-border pb-3">
      {breadcrumb?.length ? (
        <nav aria-label="面包屑" className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          {breadcrumb.map((item, index) => (
            <span key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index ? <span aria-hidden="true">/</span> : null}
              {item.href ? <Link href={item.href} className="underline decoration-border hover:text-text-primary">{item.label}</Link> : <span aria-current="page">{item.label}</span>}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex min-h-14 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="font-mono text-[10px] uppercase leading-4 tracking-[0.18em] text-text-tertiary">{eyebrow}</p>
          <h1 className="mt-1 font-display text-[clamp(1.75rem,3vw,2rem)] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-text-secondary sm:line-clamp-1 sm:text-sm" title={description}>{description}</p>
        </div>
        {status ? <span className="inline-flex min-h-9 items-center border border-border bg-bg-surface px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">{status}</span> : null}
      </div>
    </header>
  );
}
