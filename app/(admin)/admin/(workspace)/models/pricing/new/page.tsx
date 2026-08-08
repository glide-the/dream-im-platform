import AdminResourceFormPage from "@/components/admin/AdminResourceFormPage";
import { pricingFields } from "@/components/admin/AdminResourceViews";

const sections = [
  { id: "relation", title: "模型与用户层级", description: "关系来自真实模型注册表；从旧版本进入时自动继承。" },
  { id: "price", title: "四类 Token 定价", description: "按 cc-switch 分别填写 Input、Output、Cache read、Cache write 的 USD / 1M tokens。" },
  { id: "formula", title: "计价公式", description: "Markup 与 Discount 使用 bps，提交前保留精确整数。" },
  { id: "window", title: "生效窗口", description: "与相同 Model/Tier 的有效版本重叠会返回 409，并保留草稿。" },
];

export default async function NewPricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const modelId = typeof query.modelId === "string" ? query.modelId : "";
  const replaces = typeof query.replaces === "string" ? query.replaces : undefined;
  return <AdminResourceFormPage mode="create" resource="pricing-rules" seedRecordId={replaces} seedOverrides={{ effectiveFrom: new Date().toISOString(), effectiveTo: null, status: "active", ...(modelId ? { modelId } : {}) }} title="创建价格版本" eyebrow="cc-switch · model pricing" description="历史价格不可覆盖。本页创建新的时间窗口，并在需要时事务性结束旧版本。所有金额以整数 micro-USD 写入。" backHref="/admin/models/pricing" fields={pricingFields} sections={sections} defaults={{ modelId, replacesPricingRuleId: replaces ?? "", userTier: "default", inputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, effectiveFrom: new Date().toISOString(), effectiveTo: null, status: "active" }} submitLabel="创建价格版本" />;
}
