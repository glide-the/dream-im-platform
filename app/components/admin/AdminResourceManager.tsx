"use client";

import {
  type CrudFilter,
  useCan,
  useInvalidate,
  useList,
} from "@refinedev/core";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AdminTableColumn } from "./AdminResourceTable";

export type AdminFieldControl =
  | "text"
  | "email"
  | "password"
  | "url"
  | "number"
  | "textarea"
  | "select"
  | "switch"
  | "json"
  | "datetime"
  | "money"
  | "model-picker"
  | "multiselect"
  | "relation-multi"
  | "tags"
  | "capabilities"
  | "relation"
  | "hidden";

export type AdminFieldDefinition = {
  key: string;
  sourceKey?: string;
  label: string;
  control: AdminFieldControl;
  section?: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  requiredOnCreate?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number | string;
  createOnly?: boolean;
  updateOnly?: boolean;
  readOnlyOnEdit?: boolean;
  omitEmptyOnUpdate?: boolean;
  excludeKeys?: string[];
  payloadGroup?: { key: string; property: string };
  options?: Array<{ label: string; value: string }>;
  relation?: {
    resource: string;
    labelKey: string;
    secondaryKey?: string;
    searchField: string;
    valueKey?: string;
  };
};

export type AdminResourceManagerProps = {
  resource: string;
  title: string;
  description: string;
  columns: AdminTableColumn[];
  fields: AdminFieldDefinition[];
  sections?: Array<{ id: string; title: string; description?: string }>;
  filters?: Array<{
    field: string;
    label: string;
    operator?: "eq" | "contains";
    options?: Array<{ label: string; value: string }>;
  }>;
  defaultSort?: string;
  pageSize?: number;
  container?: "modal" | "drawer" | "fullscreen";
  createLabel?: string;
  submitCreateLabel?: string;
  submitUpdateLabel?: string;
  createDefaults?: Record<string, unknown>;
  presets?: Array<{
    label: string;
    description: string;
    values: Record<string, unknown>;
  }>;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  deleteLabel?: string;
  versionedCreate?: boolean;
  commands?: Array<{
    action: string;
    label: string;
    description: string;
    requiresNotes?: boolean;
    tone?: "default" | "danger" | "success";
  }>;
};

type FormValue = string | boolean | string[];
type FormValues = Record<string, FormValue>;
type OverlayMode = "create" | "edit" | "detail" | "delete" | "command";
type ResourceCommand = NonNullable<AdminResourceManagerProps["commands"]>[number];

type ApiResult = {
  data?: Record<string, unknown>;
  error?: { message?: string; details?: unknown };
};

const sensitiveKeys = new Set([
  "password_hash",
  "api_key_ciphertext",
  "api_key_iv",
  "api_key_tag",
  "key_hash",
]);

function sourceValue(
  record: Record<string, unknown>,
  field: AdminFieldDefinition,
) {
  if (field.payloadGroup) {
    const group = record[field.payloadGroup.key];
    return group && typeof group === "object" && !Array.isArray(group)
      ? (group as Record<string, unknown>)[field.payloadGroup.property]
      : undefined;
  }
  return record[field.sourceKey ?? field.key];
}

function microUsdToUsd(value: unknown) {
  try {
    const micros = BigInt(String(value ?? 0));
    const sign = micros < 0n ? "-" : "";
    const absolute = micros < 0n ? -micros : micros;
    const whole = absolute / 1_000_000n;
    const fraction = (absolute % 1_000_000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "";
  }
}

function usdToMicroUsd(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(normalized)) {
    throw new Error("USD 金额必须是非负数，且最多包含 6 位小数。");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const micros =
    BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("金额超出安全整数范围。");
  }
  return Number(micros);
}

function toLocalDateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function valuesFromRecord(
  fields: AdminFieldDefinition[],
  record: Record<string, unknown> | undefined,
  defaults: Record<string, unknown>,
  mode: "create" | "edit",
) {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = record ? sourceValue(record, field) : defaults[field.key];
      if (field.control === "switch") return [field.key, Boolean(raw)];
      if (field.control === "multiselect" || field.control === "relation-multi") {
        return [field.key, Array.isArray(raw) ? raw.map(String) : []];
      }
      if (field.control === "tags") {
        return [field.key, Array.isArray(raw) ? raw.map(String).join(", ") : ""];
      }
      if (field.control === "capabilities") {
        const capabilities =
          raw && typeof raw === "object"
            ? (raw as Record<string, unknown>)
            : {};
        return [
          field.key,
          (field.options ?? [])
            .filter((option) => Boolean(capabilities[option.value]))
            .map((option) => option.value),
        ];
      }
      if (field.control === "json") {
        const safeRaw =
          raw && typeof raw === "object" && !Array.isArray(raw) && field.excludeKeys?.length
            ? Object.fromEntries(Object.entries(raw).filter(([key]) => !field.excludeKeys?.includes(key)))
            : raw;
        return [field.key, safeRaw ? JSON.stringify(safeRaw, null, 2) : "{}"];
      }
      if (field.control === "datetime") {
        return [field.key, toLocalDateTime(raw)];
      }
      if (field.control === "money") {
        return [field.key, microUsdToUsd(raw)];
      }
      if (field.control === "password" && mode === "edit") {
        return [field.key, ""];
      }
      return [field.key, raw === null || raw === undefined ? "" : String(raw)];
    }),
  ) as FormValues;
}

function buildPayload(
  fields: AdminFieldDefinition[],
  values: FormValues,
  mode: "create" | "edit",
) {
  const payload: Record<string, unknown> = {};
  const groupedPayload: Record<string, Record<string, unknown>> = {};
  for (const field of fields) {
    if (field.control === "hidden" && values[field.key] === undefined) continue;
    if (mode === "create" && field.updateOnly) continue;
    if (mode === "edit" && (field.createOnly || field.readOnlyOnEdit)) continue;
    const value = values[field.key];
    const assign = (nextValue: unknown) => {
      if (field.payloadGroup) {
        groupedPayload[field.payloadGroup.key] ??= {};
        groupedPayload[field.payloadGroup.key][field.payloadGroup.property] = nextValue;
      } else {
        payload[field.key] = nextValue;
      }
    };
    if (
      mode === "edit" &&
      field.omitEmptyOnUpdate &&
      (value === "" || value === undefined)
    ) {
      continue;
    }
    if (field.control === "switch") {
      assign(Boolean(value));
    } else if (field.control === "number") {
      if (value === "") {
        if (field.nullable) assign(null);
      } else {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`${field.label} 必须是数字。`);
        assign(number);
      }
    } else if (field.control === "money") {
      assign(usdToMicroUsd(String(value ?? "")));
    } else if (field.control === "json") {
      try {
        assign(JSON.parse(String(value || "{}")));
      } catch {
        throw new Error(`${field.label} 必须是有效 JSON。`);
      }
    } else if (field.control === "multiselect" || field.control === "relation-multi") {
      assign(Array.isArray(value) ? value : []);
    } else if (field.control === "tags") {
      assign(String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean));
    } else if (field.control === "capabilities") {
      const selected = new Set(Array.isArray(value) ? value : []);
      assign(Object.fromEntries(
        (field.options ?? []).map((option) => [
          option.value,
          selected.has(option.value),
        ]),
      ));
    } else if (field.control === "datetime") {
      if (value === "") {
        if (field.nullable) assign(null);
      } else {
        assign(new Date(String(value)).toISOString());
      }
    } else if (field.control !== "hidden" || value !== "") {
      if (value === "" && field.nullable) assign(null);
      else if (value !== "" || field.required || mode === "create") {
        assign(value);
      }
    }
  }
  for (const [groupKey, groupValue] of Object.entries(groupedPayload)) {
    const base = payload[groupKey];
    payload[groupKey] = {
      ...(base && typeof base === "object" && !Array.isArray(base)
        ? (base as Record<string, unknown>)
        : {}),
      ...groupValue,
    };
  }
  return payload;
}

function useDialog(open: boolean, ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, ref]);
}

function RelationSelect({
  field,
  value,
  onChange,
  disabled,
  required,
}: {
  field: AdminFieldDefinition;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const relation = field.relation!;
  const [search, setSearch] = useState("");
  const { result, query } = useList<Record<string, unknown>>({
    resource: relation.resource,
    pagination: { currentPage: 1, pageSize: 50 },
    sorters: [{ field: relation.labelKey, order: "asc" }],
    filters: search
      ? [
          {
            field: relation.searchField,
            operator: "contains",
            value: search,
          },
        ]
      : [],
  });
  return (
    <div className="space-y-2">
      <input
        className="admin-field text-sm"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`搜索${field.label}`}
        disabled={disabled}
        aria-label={`搜索${field.label}选项`}
      />
      <select
        className="admin-field text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled || query.isLoading}
      >
        <option value="">{query.isLoading ? "正在加载…" : `选择${field.label}`}</option>
        {result.data.map((option) => {
          const label = String(option[relation.labelKey] ?? option.id);
          const secondary = relation.secondaryKey
            ? option[relation.secondaryKey]
            : undefined;
          return (
            <option key={String(option.id)} value={String(option[relation.valueKey ?? "id"])}>
              {label}{secondary ? ` · ${String(secondary)}` : ""}
            </option>
          );
        })}
      </select>
      {query.error ? (
        <p className="text-xs text-danger" role="alert">
          关系选项加载失败：{query.error.message}
        </p>
      ) : null}
    </div>
  );
}

function MultiRelationSelect({
  field,
  value,
  onChange,
  disabled,
}: {
  field: AdminFieldDefinition;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const relation = field.relation!;
  const [search, setSearch] = useState("");
  const { result, query } = useList<Record<string, unknown>>({
    resource: relation.resource,
    pagination: { currentPage: 1, pageSize: 100 },
    sorters: [{ field: relation.labelKey, order: "asc" }],
    filters: search
      ? [{ field: relation.searchField, operator: "contains", value: search }]
      : [],
  });
  return (
    <div className="mt-2 space-y-2">
      <input className="admin-field text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${field.label}`} disabled={disabled} />
      <div className="max-h-56 overflow-y-auto border border-border bg-bg-surface p-2">
        {query.isLoading ? <p className="p-2 text-xs text-text-tertiary">正在加载…</p> : result.data.map((option) => {
          const optionValue = String(option[relation.valueKey ?? "id"]);
          const checked = value.includes(optionValue);
          return <label key={String(option.id)} className="flex min-h-10 items-center gap-2 border-b border-border px-2 text-sm last:border-0"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...value, optionValue] : value.filter((item) => item !== optionValue))} /><span>{String(option[relation.labelKey] ?? option.id)}</span>{relation.secondaryKey && option[relation.secondaryKey] ? <span className="font-mono text-[10px] text-text-tertiary">{String(option[relation.secondaryKey])}</span> : null}</label>;
        })}
      </div>
      {query.error ? <p className="text-xs text-danger" role="alert">关系选项加载失败：{query.error.message}</p> : null}
    </div>
  );
}

function FieldControl({
  field,
  value,
  mode,
  onChange,
}: {
  field: AdminFieldDefinition;
  value: FormValue;
  mode: "create" | "edit";
  onChange: (value: FormValue) => void;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const disabled = mode === "edit" && field.readOnlyOnEdit;
  const required = Boolean(field.required || (field.requiredOnCreate && mode === "create"));
  if (field.control === "hidden") return null;
  const common = {
    id,
    required: required && !disabled,
    disabled,
    className: "admin-field mt-2 text-sm disabled:cursor-not-allowed disabled:opacity-60",
  };
  return (
    <label className={`block text-xs font-semibold text-text-secondary ${["textarea", "json", "multiselect", "relation-multi", "tags", "capabilities", "relation"].includes(field.control) ? "sm:col-span-2" : ""}`}>
      <span>{field.label}{required ? " *" : ""}</span>
      {field.control === "relation" ? (
        <RelationSelect
          field={field}
          value={String(value ?? "")}
          onChange={onChange}
          disabled={disabled}
          required={required}
        />
      ) : field.control === "relation-multi" ? (
        <MultiRelationSelect field={field} value={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />
      ) : field.control === "select" ? (
        <select {...common} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {field.nullable ? <option value="">未设置</option> : null}
          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : field.control === "switch" ? (
        <span className="mt-2 flex min-h-11 items-center gap-3 border border-border bg-bg-surface px-3">
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
          <span className="text-sm font-normal text-text-primary">{value ? "启用" : "停用"}</span>
        </span>
      ) : field.control === "textarea" || field.control === "json" ? (
        <textarea {...common} rows={field.control === "json" ? 8 : 4} spellCheck={field.control !== "json"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={`${common.className} min-h-28 ${field.control === "json" ? "font-mono text-xs leading-5" : ""}`} />
      ) : field.control === "password" ? (
        <span className="relative mt-2 block">
          <input {...common} type={revealed ? "text" : "password"} value={String(value ?? "")} placeholder={field.placeholder} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} className={`${common.className} mt-0 pr-20 font-mono text-xs`} />
          {value ? <button type="button" onClick={() => setRevealed((current) => !current)} className="absolute inset-y-0 right-0 min-h-11 px-3 text-xs font-semibold text-text-secondary" aria-label={revealed ? `隐藏${field.label}` : `显示${field.label}`}>{revealed ? "隐藏" : "显示"}</button> : null}
        </span>
      ) : field.control === "model-picker" ? (
        <span className="mt-2 block space-y-2">
          <input {...common} type="text" list={`${id}-models`} value={String(value ?? "")} placeholder={field.placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} className={`${common.className} mt-0 font-mono text-xs`} />
          <datalist id={`${id}-models`}>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>
          <span className="block text-[11px] font-normal leading-5 text-text-tertiary">从常用上游型号下拉选择，或输入 Provider 实际支持的自定义型号。</span>
        </span>
      ) : field.control === "multiselect" || field.control === "capabilities" ? (
        <span className="mt-2 grid gap-2 border border-border bg-bg-surface p-3 sm:grid-cols-2">
          {(field.options ?? []).map((option) => {
            const selected = Array.isArray(value) && value.includes(option.value);
            return <label key={option.value} className="flex min-h-9 items-center gap-2 text-sm font-normal text-text-primary"><input type="checkbox" checked={selected} onChange={(event) => onChange(event.target.checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter((item) => item !== option.value))} />{option.label}</label>;
          })}
        </span>
      ) : (
        <input
          {...common}
          type={field.control === "money" || field.control === "number" ? "number" : field.control === "datetime" ? "datetime-local" : field.control}
          value={String(value ?? "")}
          min={field.min}
          max={field.max}
          step={field.control === "money" ? "0.000001" : field.step}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.control === "money" && value !== "" ? (
        <span className="mt-1 block font-mono text-[11px] font-normal text-text-tertiary">
          {(() => { try { return `${usdToMicroUsd(String(value))} micro-USD / 1M tokens`; } catch { return "请输入最多 6 位小数的 USD 金额"; } })()}
        </span>
      ) : null}
      {field.help ? <span className="mt-1 block text-xs font-normal leading-5 text-text-tertiary">{field.help}</span> : null}
    </label>
  );
}

function statusClass(value: unknown) {
  const status = String(value ?? "").toLowerCase();
  if (["active", "enabled", "confirmed", "completed", "published", "success", "settled"].includes(status)) return "border-success/35 bg-success-light text-success";
  if (["failed", "rejected", "disabled", "closed", "cancelled", "settlement_failed", "revoked"].includes(status)) return "border-danger/35 bg-danger-light text-danger";
  return "border-border bg-bg-secondary text-text-secondary";
}

function renderCell(value: unknown, format?: AdminTableColumn["format"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "money") return `$${microUsdToUsd(value)}`;
  if (format === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN");
  }
  if (format === "boolean") return value ? "启用" : "停用";
  if (format === "json") return Array.isArray(value) ? value.join("、") : JSON.stringify(value);
  return String(value);
}

export default function AdminResourceManager(props: AdminResourceManagerProps) {
  const {
    resource,
    title,
    description,
    columns,
    fields,
    sections = [{ id: "main", title: "基础信息" }],
    filters: filterDefinitions = [],
    defaultSort = "created_at",
    pageSize = 12,
    container = "drawer",
    createLabel = "新增",
    submitCreateLabel = "创建",
    submitUpdateLabel = "保存更改",
    createDefaults = {},
    presets = [],
    canCreate = true,
    canEdit = true,
    canDelete = false,
    deleteLabel = "删除",
    versionedCreate = false,
    commands = [],
  } = props;
  const access = useCan({ resource, action: "create" });
  const invalidate = useInvalidate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [appliedFilters, setAppliedFilters] = useState<CrudFilter[]>([]);
  const [mode, setMode] = useState<OverlayMode | null>(null);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [values, setValues] = useState<FormValues>(() => valuesFromRecord(fields, undefined, createDefaults, "create"));
  const [initialValues, setInitialValues] = useState<FormValues>(values);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeCommand, setActiveCommand] = useState<ResourceCommand | null>(null);
  const [commandNotes, setCommandNotes] = useState("");
  const [oneTimeSecret, setOneTimeSecret] = useState("");
  useDialog(mode !== null, dialogRef);
  const { result, query } = useList<Record<string, unknown>>({
    resource,
    pagination: { currentPage: page, pageSize },
    sorters: [{ field: defaultSort, order: "desc" }],
    filters: appliedFilters,
  });
  const pages = Math.max(1, Math.ceil((result.total ?? 0) / pageSize));
  const dirty = mode === "create" || mode === "edit" ? JSON.stringify(values) !== JSON.stringify(initialValues) : false;
  const detailEntries = useMemo(() => record ? Object.entries(record).filter(([key]) => !sensitiveKeys.has(key)) : [], [record]);

  function close(force = false) {
    if (!force && dirty && !window.confirm("存在未保存更改，确认放弃吗？")) return;
    setMode(null);
    setError("");
    setRecord(null);
    setOneTimeSecret("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function rememberTrigger(target: EventTarget | null) {
    triggerRef.current = target instanceof HTMLElement ? target : null;
  }

  function openCreate(event: React.MouseEvent<HTMLElement>, base?: Record<string, unknown>) {
    rememberTrigger(event.currentTarget);
    const nextDefaults = { ...createDefaults, ...base };
    const next = valuesFromRecord(fields, undefined, nextDefaults, "create");
    setValues(next);
    setInitialValues(next);
    setRecord(null);
    setError("");
    setSuccess("");
    setMode("create");
  }

  async function loadRecord(id: string, nextMode: "detail" | "edit" | "delete" | "command", target: EventTarget | null) {
    rememberTrigger(target);
    setMode(nextMode);
    setLoadingRecord(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/${resource}/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
      const result = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? `加载失败（HTTP ${response.status}）`);
      setRecord(result.data);
      if (nextMode === "edit") {
        const next = valuesFromRecord(fields, result.data, createDefaults, "edit");
        setValues(next);
        setInitialValues(next);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "记录加载失败");
    } finally {
      setLoadingRecord(false);
    }
  }

  function openCommand(
    event: React.MouseEvent<HTMLElement>,
    row: Record<string, unknown>,
    command: ResourceCommand,
  ) {
    setActiveCommand(command);
    setCommandNotes("");
    void loadRecord(String(row.id), "command", event.currentTarget);
  }

  function openVersion(event: React.MouseEvent<HTMLElement>, row: Record<string, unknown>) {
    const base: Record<string, unknown> = {
      replacesPricingRuleId: row.id,
      modelId: row.model_id,
      userTier: row.user_tier,
      effectiveFrom: new Date().toISOString(),
    };
    for (const field of fields.filter((item) => item.control === "money" || ["markupBps", "discountBps"].includes(item.key))) {
      base[field.key] = row[field.sourceKey ?? field.key];
    }
    openCreate(event, base);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setAppliedFilters(filterDefinitions.flatMap((filter) => {
      const value = draftFilters[filter.field]?.trim();
      return value ? [{ field: filter.field, operator: filter.operator ?? "contains", value } as CrudFilter] : [];
    }));
    setPage(1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode !== "create" && mode !== "edit") return;
    setPending(true);
    setError("");
    try {
      const payload = buildPayload(fields, values, mode);
      const response = await fetch(mode === "create" ? `/api/admin/${resource}` : `/api/admin/${resource}/${encodeURIComponent(String(record?.id))}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok) throw new Error(result.error?.message ?? `操作失败（HTTP ${response.status}）`);
      await invalidate({ resource, invalidates: ["list", "detail"] });
      setSuccess(`${mode === "create" ? submitCreateLabel : submitUpdateLabel}成功：${String(result.data?.id ?? record?.id ?? "")}`);
      if (mode === "create" && result.data?.plaintextKey) {
        setRecord(result.data);
        setOneTimeSecret(String(result.data.plaintextKey));
        setMode("detail");
      } else {
        close(true);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!record?.id) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/${resource}/${encodeURIComponent(String(record.id))}`, { method: "DELETE", headers: { accept: "application/json" } });
      const result = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok) throw new Error(result.error?.message ?? `${deleteLabel}失败（HTTP ${response.status}）`);
      await invalidate({ resource, invalidates: ["list", "detail"] });
      setSuccess(`${deleteLabel}成功：${String(record.id)}`);
      close(true);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `${deleteLabel}失败`);
    } finally {
      setPending(false);
    }
  }

  async function runCommand() {
    if (!record?.id || !activeCommand) return;
    if (activeCommand.requiresNotes && commandNotes.trim().length < 1) {
      setError("该操作必须填写说明。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/${resource}/${encodeURIComponent(String(record.id))}/${encodeURIComponent(activeCommand.action)}`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(
            commandNotes.trim() ? { reviewNotes: commandNotes.trim() } : {},
          ),
        },
      );
      const result = (await response.json().catch(() => ({}))) as ApiResult;
      if (!response.ok) {
        throw new Error(
          result.error?.message ?? `${activeCommand.label}失败（HTTP ${response.status}）`,
        );
      }
      await invalidate({ resource, invalidates: ["list", "detail"] });
      setSuccess(`${activeCommand.label}成功：${String(record.id)}`);
      close(true);
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : `${activeCommand.label}失败`,
      );
    } finally {
      setPending(false);
    }
  }

  const formMode = mode === "create" ? "create" : "edit";
  return (
    <section className="admin-panel min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-5">
        <div className="max-w-3xl"><h2 className="font-display text-xl font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p></div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary" aria-live="polite">{query.isFetching ? "正在同步" : `${result.total ?? 0} 条记录`}</span>
          {canCreate && access.data?.can ? <button type="button" onClick={openCreate} className="min-h-11 bg-text-primary px-4 text-sm font-semibold text-bg-surface">{createLabel}</button> : null}
        </div>
      </header>
      {filterDefinitions.length ? <form onSubmit={applyFilters} className="grid gap-3 border-b border-border bg-bg-secondary/45 p-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(150px,1fr))_auto]">{filterDefinitions.map((filter) => <label key={filter.field} className="text-xs font-semibold text-text-secondary">{filter.label}{filter.options ? <select className="admin-field mt-1 text-sm" value={draftFilters[filter.field] ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, [filter.field]: event.target.value }))}><option value="">全部</option>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input className="admin-field mt-1 text-sm" value={draftFilters[filter.field] ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, [filter.field]: event.target.value }))} placeholder={`筛选${filter.label}`} />}</label>)}<div className="flex items-end gap-2"><button className="min-h-11 bg-text-primary px-4 text-sm font-semibold text-bg-surface">应用</button><button type="button" onClick={() => { setDraftFilters({}); setAppliedFilters([]); setPage(1); }} className="min-h-11 border border-border bg-bg-surface px-4 text-sm">清除</button></div></form> : null}
      {query.error ? <div className="m-4 border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert"><p className="font-semibold">数据暂时不可用</p><p className="mt-1">{query.error.message}</p><button type="button" onClick={() => query.refetch()} className="mt-3 min-h-10 underline">重新加载</button></div> : null}
      {success ? <p className="m-4 border border-success/35 bg-success-light p-3 text-sm text-success" role="status">{success}</p> : null}
      <div className="max-w-full overflow-x-auto" tabIndex={0} aria-label={`${title}数据表，可横向滚动`}>
        <table className="min-w-full border-collapse text-left text-sm"><caption className="sr-only">{title}；{description}</caption><thead><tr className="border-b border-border bg-bg-secondary/45">{columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{column.label}</th>)}<th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">操作</th></tr></thead>
          <tbody>{query.isLoading ? Array.from({ length: 5 }).map((_, index) => <tr key={index} className="border-b border-border" aria-hidden="true"><td colSpan={columns.length + 1} className="px-4 py-4"><span className="block h-4 max-w-3xl animate-pulse bg-bg-secondary" /></td></tr>) : null}{result.data.map((row, index) => <tr key={String(row.id ?? index)} className="border-b border-border last:border-0 hover:bg-bg-secondary/35">{columns.map((column) => <td key={column.key} className={`max-w-[300px] px-4 py-3.5 text-text-secondary ${column.key === "id" ? "font-mono text-[11px]" : ""}`}><span className={column.format === "status" ? `inline-flex whitespace-nowrap border px-2 py-1 text-xs font-semibold ${statusClass(row[column.key])}` : "block truncate"} title={renderCell(row[column.key], column.format)}>{renderCell(row[column.key], column.format)}</span></td>)}<td className="whitespace-nowrap px-4 py-3 text-right"><button type="button" onClick={(event) => loadRecord(String(row.id), "detail", event.currentTarget)} className="min-h-10 px-2 text-xs font-semibold underline">查看</button>{canEdit && access.data?.can ? <button type="button" onClick={(event) => loadRecord(String(row.id), "edit", event.currentTarget)} className="min-h-10 px-2 text-xs font-semibold underline">{versionedCreate ? "关闭/停用" : "编辑"}</button> : null}{versionedCreate && access.data?.can ? <button type="button" onClick={(event) => openVersion(event, row)} className="min-h-10 px-2 text-xs font-semibold underline">创建新版本</button> : null}{commands.map((command) => <button key={command.action} type="button" onClick={(event) => openCommand(event, row, command)} className={`min-h-10 px-2 text-xs font-semibold underline ${command.tone === "danger" ? "text-danger" : command.tone === "success" ? "text-success" : ""}`}>{command.label}</button>)}{canDelete && access.data?.can ? <button type="button" onClick={(event) => loadRecord(String(row.id), "delete", event.currentTarget)} className="min-h-10 px-2 text-xs font-semibold text-danger underline">{deleteLabel}</button> : null}</td></tr>)}{!query.isLoading && !query.error && result.data.length === 0 ? <tr><td colSpan={columns.length + 1} className="px-5 py-14 text-center"><p className="font-display text-lg font-semibold">暂无匹配记录</p><p className="mt-2 text-sm text-text-tertiary">保留当前筛选；可清除筛选或等待真实数据产生。</p></td></tr> : null}</tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-4 py-4"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">上一页</button><span className="font-mono text-[10px] text-text-tertiary">第 {page} / {pages} 页</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))} className="min-h-10 border border-border px-4 text-xs font-semibold disabled:opacity-40">下一页</button></footer>
      {mode ? <dialog ref={dialogRef} className={`admin-dialog admin-dialog--${mode === "detail" ? "drawer" : container}`} onCancel={(event) => { event.preventDefault(); close(); }} aria-labelledby={`${resource}-overlay-title`}><div className="admin-dialog-frame"><header className="admin-dialog-header"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">{mode === "detail" ? "Record detail" : mode === "create" ? "Create resource" : mode === "edit" ? "Edit resource" : "High-risk action"}</p><h2 id={`${resource}-overlay-title`} className="mt-2 font-display text-2xl font-semibold">{mode === "create" ? createLabel : mode === "delete" ? deleteLabel : mode === "command" ? activeCommand?.label : title}</h2>{record?.id ? <p className="mt-2 break-all font-mono text-[11px] text-text-tertiary">{String(record.id)}</p> : null}</div><button type="button" onClick={() => close()} className="min-h-11 border border-border px-4 text-sm">关闭</button></header><div className="admin-dialog-body">{loadingRecord ? <div className="space-y-3" aria-label="正在加载记录"><span className="block h-5 w-2/3 animate-pulse bg-bg-secondary" /><span className="block h-32 animate-pulse bg-bg-secondary" /></div> : error ? <div className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert"><p className="font-semibold">操作暂时无法继续</p><p className="mt-2">{error}</p></div> : mode === "detail" && record ? <div>{oneTimeSecret ? <section className="mb-5 border border-warning/50 bg-accent-orange-light p-4"><p className="font-semibold">Gateway Key 明文仅显示一次</p><code className="mt-3 block break-all text-xs">{oneTimeSecret}</code><button type="button" onClick={() => navigator.clipboard.writeText(oneTimeSecret)} className="mt-3 min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface">复制密钥</button><p className="mt-2 text-xs leading-5 text-text-secondary">关闭本回执后无法恢复；数据库只保存哈希与前缀。</p></section> : null}<dl className="divide-y divide-border">{detailEntries.filter(([key]) => key !== "plaintextKey").map(([key, value]) => <div key={key} className="grid gap-2 py-4 sm:grid-cols-[170px_minmax(0,1fr)]"><dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{key}</dt><dd className={`min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary ${typeof value === "object" ? "font-mono text-xs" : ""}`}>{formatDetailValue(value)}</dd></div>)}</dl></div> : mode === "delete" && record ? <div className="space-y-4"><p className="border border-danger/35 bg-danger-light p-4 text-sm text-danger">{deleteLabel}会移除当前覆盖记录或自定义资源；外键和内置资源保护仍由服务器强制执行。</p><dl className="border-y border-border py-3 text-sm"><dt className="text-text-tertiary">目标</dt><dd className="mt-1 font-mono">{String(record.id)}</dd></dl></div> : mode === "command" && record && activeCommand ? <div className="space-y-5"><p className={`border p-4 text-sm leading-6 ${activeCommand.tone === "danger" ? "border-danger/35 bg-danger-light text-danger" : "border-warning/40 bg-accent-orange-light text-text-primary"}`}>{activeCommand.description}</p><dl className="grid gap-2 border-y border-border py-4 text-sm sm:grid-cols-[140px_1fr]"><dt className="text-text-tertiary">目标记录</dt><dd className="font-mono">{String(record.id)}</dd><dt className="text-text-tertiary">当前状态</dt><dd>{String(record.status ?? record.review_status ?? "—")}</dd></dl><label className="block text-xs font-semibold text-text-secondary">操作说明{activeCommand.requiresNotes ? " *" : "（可选）"}<textarea className="admin-field mt-2 min-h-24 text-sm" value={commandNotes} onChange={(event) => setCommandNotes(event.target.value)} maxLength={2000} required={activeCommand.requiresNotes} /></label></div> : <form id={`${resource}-form`} onSubmit={submit} className="space-y-8">{presets.length && mode === "create" ? <section><h3 className="text-sm font-semibold">预设配置</h3><p className="mt-1 text-xs leading-5 text-text-tertiary">预设只负责填充字段，不绕过服务端校验。</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{presets.map((preset) => <button key={preset.label} type="button" onClick={() => setValues(valuesFromRecord(fields, undefined, { ...createDefaults, ...preset.values }, "create"))} className="border border-border bg-bg-surface p-3 text-left hover:bg-bg-secondary"><span className="block text-sm font-semibold">{preset.label}</span><span className="mt-1 block text-xs leading-5 text-text-tertiary">{preset.description}</span></button>)}</div></section> : null}{sections.map((section) => { const sectionFields = fields.filter((field) => (field.section ?? "main") === section.id && !(mode === "create" && field.updateOnly) && !(mode === "edit" && field.createOnly)); return sectionFields.length ? <fieldset key={section.id} className="border-t border-border pt-5"><legend className="font-display text-lg font-semibold">{section.title}</legend>{section.description ? <p className="mt-1 text-sm leading-6 text-text-secondary">{section.description}</p> : null}<div className="mt-4 grid gap-4 sm:grid-cols-2">{sectionFields.map((field) => <FieldControl key={field.key} field={field} value={values[field.key] ?? (field.control === "switch" ? false : "")} mode={formMode} onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))} />)}</div></fieldset> : null; })}</form>}</div>{mode !== "detail" && !loadingRecord ? <footer className="admin-dialog-footer"><button type="button" onClick={() => close()} className="min-h-11 border border-border bg-bg-surface px-4 text-sm">取消</button>{mode === "delete" ? <button type="button" disabled={pending || Boolean(error)} onClick={remove} className="min-h-11 bg-danger px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "处理中…" : deleteLabel}</button> : mode === "command" ? <button type="button" disabled={pending || Boolean(error)} onClick={runCommand} className={`min-h-11 px-5 text-sm font-semibold text-white disabled:opacity-50 ${activeCommand?.tone === "danger" ? "bg-danger" : "bg-text-primary"}`}>{pending ? "处理中…" : activeCommand?.label}</button> : <button type="submit" form={`${resource}-form`} disabled={pending || Boolean(error)} className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface disabled:opacity-50">{pending ? "保存中…" : mode === "create" ? submitCreateLabel : submitUpdateLabel}</button>}</footer> : null}</div></dialog> : null}
    </section>
  );
}
