"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type FilterValues = Record<string, unknown>;

function comparableFilterValues(values: FilterValues) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value] as const)
      .filter(([, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        return value !== "" && value !== null && value !== undefined && value !== false;
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function countActiveFilterValues(values: FilterValues) {
  return Object.keys(comparableFilterValues(values)).length;
}

export function haveFilterValuesChanged(
  draft: FilterValues,
  applied: FilterValues,
) {
  return JSON.stringify(comparableFilterValues(draft)) !== JSON.stringify(comparableFilterValues(applied));
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M3 5h14M6 10h8M8.5 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      data-filter-chevron
      className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AdminListHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="font-mono text-[10px] uppercase leading-4 tracking-[0.14em] text-text-tertiary">{eyebrow}</p> : null}
        <h2 className="font-display text-lg font-semibold leading-6 text-text-primary">{title}</h2>
        {description ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-text-secondary sm:line-clamp-1" title={description}>{description}</p> : null}
      </div>
      <div className="flex min-h-11 shrink-0 items-center gap-2">
        {meta}
        {actions}
      </div>
    </header>
  );
}

export function AdminCollapsibleFilters({
  children,
  activeCount,
  dirty = false,
  label = "筛选",
  defaultExpanded = false,
}: {
  children: ReactNode;
  activeCount: number;
  dirty?: boolean;
  label?: string;
  defaultExpanded?: boolean;
}) {
  const reactId = useId();
  const id = useMemo(() => reactId.replace(/:/g, ""), [reactId]);
  const triggerId = `${id}-filter-trigger`;
  const regionId = `${id}-filter-region`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isNarrow || !dialog) return;
    if (expanded && !dialog.open) dialog.showModal();
    if (!expanded && dialog.open) dialog.close();
  }, [expanded, isNarrow]);

  function close() {
    setExpanded(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const fields = (
    <div className="bg-bg-secondary/30 p-3 sm:p-4" data-query-region>
      {children}
    </div>
  );

  return (
    <div className="border-b border-border bg-bg-surface">
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:px-4">
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex min-h-11 items-center gap-2 border border-border bg-bg-surface px-3 text-sm font-semibold text-text-primary"
        >
          <FilterIcon />
          <span>{expanded ? `收起${label}` : `展开${label}`}</span>
          {activeCount ? <span className="inline-flex min-w-6 justify-center border border-border bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px]" aria-label={`已应用 ${activeCount} 项`}>{activeCount}</span> : null}
          <ChevronIcon open={expanded} />
        </button>
        <span className="text-xs text-text-tertiary" aria-live="polite">
          {activeCount ? `已应用 ${activeCount} 项` : "暂无生效条件"}
        </span>
        {dirty ? <span className="text-xs font-semibold text-accent-orange" role="status">有未应用更改</span> : null}
      </div>

      {isNarrow ? (
        <dialog
          ref={dialogRef}
          id={regionId}
          aria-labelledby={`${id}-filter-title`}
          className="m-0 mt-auto max-h-[88dvh] w-full max-w-none border border-border bg-bg-surface p-0 text-text-primary shadow-medium backdrop:bg-black/35"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClose={() => setExpanded(false)}
          onClick={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div className="flex max-h-[88dvh] flex-col">
            <div className="flex min-h-14 items-center justify-between border-b border-border px-4">
              <div>
                <h3 id={`${id}-filter-title`} className="font-display text-lg font-semibold">{label}</h3>
                <p className="text-xs text-text-tertiary">{activeCount ? `已应用 ${activeCount} 项` : "设置查询条件"}</p>
              </div>
              <button type="button" onClick={close} className="min-h-11 min-w-11 border border-border px-3 text-sm" aria-label={`关闭${label}`}>关闭</button>
            </div>
            <div className="min-h-0 overflow-y-auto">{fields}</div>
          </div>
        </dialog>
      ) : (
        <div id={regionId} role="region" aria-labelledby={triggerId} hidden={!expanded}>
          {fields}
        </div>
      )}
    </div>
  );
}
