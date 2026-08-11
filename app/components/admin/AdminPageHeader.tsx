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
    <header>
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
          {eyebrow ? <p className="font-mono text-[10px] uppercase leading-4 tracking-[0.18em] text-text-tertiary">{eyebrow}</p> : null}
          <h1 className={`${eyebrow ? "mt-2" : ""} font-display text-[clamp(2.25rem,4vw,3.5rem)] font-semibold leading-tight tracking-[-0.04em]`}>{title}</h1>
          {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary" title={description}>{description}</p> : null}
        </div>
        {status ? <span className="inline-flex min-h-9 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{status}</span> : null}
      </div>
    </header>
  );
}
