"use client";

// [Input] Existing pricing version, model identity, and optional Image-center mode.
// [Output] Shared immutable pricing-version form with text and Image Token components.
// [Pos] AI model-center pricing interaction; integer conversion and write validation remain server-owned.
// [Sync] 2026-10-10: return Image pricing to the independent center and filter model choices.
// [Sync] 2026-10-09: separate runnable configured Image prices from optional audited Provider billing evidence.
// [Sync] 2026-10-09: persist the Provider-matched Image pricing contract basis with each version.

import { useEffect, useState } from "react";

import AdminResourceFormPage from "./AdminResourceFormPage";
import type { FormValues } from "./AdminResourceManager";
import { pricingFields } from "./AdminResourceViews";

const sections = [
  { id: "relation", title: "模型与用户层级", description: "关系来自真实模型注册表；从当前版本进入时自动继承。" },
  { id: "price", title: "四类 Token 定价", description: "按 cc-switch 分别填写 Input、Output、Cache read、Cache write 的 USD / 1M tokens。" },
  { id: "image-price", title: "图像 Token 定价", description: "按 Provider 实际用量分别填写 Image input 与 Image output；留空表示该分项尚未可调用。" },
  { id: "formula", title: "计价公式", description: "Markup 与 Discount 使用 bps，提交前保留精确整数。" },
  { id: "window", title: "生效窗口", description: "提交时自动识别相同 Model/Tier 的开放版本，并在同一事务结束旧窗口、创建新版本。" },
];

export const imagePricingFields = pricingFields.map((field) => {
  if (field.key === "modelId" && field.relation) return {
    ...field, relation: { ...field.relation, filters: [{ field: "image_capable", operator: "eq" as const, value: "true" }] },
  };
  if (["outputPriceMicrousdPerMillion", "cacheReadPriceMicrousdPerMillion", "cacheWritePriceMicrousdPerMillion"].includes(field.key)) return { ...field, section: "image-internal" };
  return field;
});

const imageSections = sections.map((section) => section.id === "price" ? { ...section, title: "文本输入价格", description: "配置图片描述的输入 Token 平台单价。" } : section);

type CurrentPricing = {
  id: string;
  model_code: string;
  user_tier: string;
  source?: string;
  input_price_microusd_per_million: string;
  output_price_microusd_per_million: string;
  cache_read_price_microusd_per_million: string;
  cache_write_price_microusd_per_million: string;
  image_input_price_microusd_per_million?: string | null;
  image_output_price_microusd_per_million?: string | null;
  effective_from: string;
  effective_to: string | null;
};

function usd(value: unknown) {
  try {
    const micros = BigInt(String(value ?? 0));
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return `$${whole}${fraction ? `.${fraction}` : ""}`;
  } catch {
    return "—";
  }
}

function PricingReplacementContext({
  modelId,
  userTier,
  effectiveFrom,
  explicitReplacementId,
}: {
  modelId: string;
  userTier: string;
  effectiveFrom: string;
  explicitReplacementId?: string;
}) {
  const queryKey = `${modelId}\u0000${userTier}`;
  const [result, setResult] = useState<{
    key: string;
    current?: CurrentPricing;
    error?: string;
  }>();

  useEffect(() => {
    if (!modelId || !userTier) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: "1",
      pageSize: "10",
      sort: "effective_from",
      order: "desc",
      "filter[model_id][eq]": modelId,
      "filter[user_tier][eq]": userTier,
      "filter[status][eq]": "active",
    });
    fetch(`/api/admin/pricing-rules?${params}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(body.data)) {
          throw new Error(body.error?.message ?? "当前价格版本加载失败");
        }
        setResult({
          key: queryKey,
          current: body.data.find(
            (row: CurrentPricing) => row.effective_to === null,
          ),
        });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setResult({
            key: queryKey,
            error: caught instanceof Error ? caught.message : "当前价格版本加载失败",
          });
        }
      });
    return () => controller.abort();
  }, [modelId, queryKey, userTier]);

  const loading = Boolean(modelId && userTier && result?.key !== queryKey);
  const current = result?.key === queryKey ? result.current : undefined;
  const error = result?.key === queryKey ? result.error : undefined;

  const proposed = new Date(effectiveFrom);
  const currentFrom = current ? new Date(current.effective_from) : undefined;
  const timeConflict = Boolean(
    currentFrom &&
      !Number.isNaN(proposed.getTime()) &&
      proposed <= currentFrom,
  );
  const staleExplicitTarget = Boolean(
    explicitReplacementId &&
      current &&
      explicitReplacementId !== current.id,
  );

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5" aria-live="polite">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        Version transition
      </p>
      <h2 className="mt-2 font-display text-lg font-semibold">当前价格版本</h2>
      {!modelId || !userTier ? (
        <p className="mt-3 text-xs leading-5 text-text-secondary">选择模型并填写用户层级后显示将被替换的版本。</p>
      ) : loading ? (
        <span className="mt-4 block h-20 animate-pulse rounded-xl bg-bg-secondary" />
      ) : error ? (
        <p className="mt-3 border border-danger/35 bg-danger-light p-3 text-xs text-danger">{error}</p>
      ) : current ? (
        <>
          <p className="mt-3 text-sm font-semibold">{current.model_code} · {current.user_tier}</p>
          <p className="mt-1 font-mono text-[10px] text-text-tertiary">
            {current.id} · {current.source ?? "manual"}
          </p>
          <dl className="mt-4 grid grid-cols-2 border-l border-t border-border text-xs">
            {[
              ["Input", current.input_price_microusd_per_million],
              ["Output", current.output_price_microusd_per_million],
              ["Cache read", current.cache_read_price_microusd_per_million],
              ["Cache write", current.cache_write_price_microusd_per_million],
              ["Image input", current.image_input_price_microusd_per_million ?? "未配置"],
              ["Image output", current.image_output_price_microusd_per_million ?? "未配置"],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-r border-border p-3">
                <dt className="text-text-tertiary">{label}</dt>
                <dd className="mt-1 font-mono font-semibold">{value === "未配置" ? value : usd(value)}</dd>
              </div>
            ))}
          </dl>
          <p className={`mt-3 text-xs leading-5 ${timeConflict || staleExplicitTarget ? "text-danger" : "text-text-secondary"}`}>
            {staleExplicitTarget
              ? "链接中的替换目标已不是当前开放版本，请返回列表重新进入。"
              : timeConflict
                ? `生效时间必须晚于 ${currentFrom?.toLocaleString("zh-CN")}。`
                : `提交后，当前版本将在 ${Number.isNaN(proposed.getTime()) ? "所选时间" : proposed.toLocaleString("zh-CN")} 原子结束。`}
          </p>
        </>
      ) : (
        <p className="mt-3 border border-success/35 bg-success-light p-3 text-xs leading-5 text-success">当前没有开放价格；本次将创建首个版本。</p>
      )}
    </section>
  );
}

export default function PricingVersionFormPage({
  modelId,
  replaces,
  initialEffectiveFrom,
  imageMode = false,
}: {
  modelId: string;
  replaces?: string;
  initialEffectiveFrom: string;
  imageMode?: boolean;
}) {
  return (
    <AdminResourceFormPage
      mode="create"
      resource="pricing-rules"
      seedRecordId={replaces}
      seedOverrides={{
        effectiveFrom: initialEffectiveFrom,
        effectiveTo: null,
        status: "active",
        ...(modelId ? { modelId } : {}),
      }}
      title="创建价格版本"
      eyebrow="cc-switch · model pricing"
      description={imageMode ? "Admin 平台按这里配置的文本输入、图像输入和图像输出 Token 单价结算，不按图片张数收费。OpenAI、models.dev 或其他上游价格只作为可选参考来源，不是运行门禁，也不表示上游逐请求扣款。历史版本不可覆盖。" : "历史价格不可覆盖。选择 Model/Tier 后会显示当前开放版本；提交时由 PostgreSQL 事务结束旧窗口并创建新版本。所有金额以整数 micro-USD 写入。"}
      backHref={imageMode ? "/admin/image-models/pricing" : "/admin/models/pricing"}
      fields={imageMode ? imagePricingFields : pricingFields}
      sections={imageMode ? imageSections : sections}
      defaults={{
        modelId,
        replacesPricingRuleId: replaces ?? "",
        userTier: "default",
        inputPriceMicrousdPerMillion: 0,
        outputPriceMicrousdPerMillion: 0,
        cacheReadPriceMicrousdPerMillion: 0,
        cacheWritePriceMicrousdPerMillion: 0,
        imageInputPriceMicrousdPerMillion: null,
        imageOutputPriceMicrousdPerMillion: null,
        imagePricingBasis: null,
        priceSourceRef: null,
        priceSourceVersion: null,
        markupBps: 0,
        discountBps: 0,
        effectiveFrom: initialEffectiveFrom,
        effectiveTo: null,
        status: "active",
      }}
      submitLabel="创建价格版本"
      context={(values: FormValues) => (
        <PricingReplacementContext
          modelId={String(values.modelId ?? "")}
          userTier={String(values.userTier ?? "")}
          effectiveFrom={String(values.effectiveFrom ?? "")}
          explicitReplacementId={replaces}
        />
      )}
    />
  );
}
