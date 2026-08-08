import AdminResourceTable from "@/components/admin/AdminResourceTable";
import ModelCenterActions from "@/components/admin/ModelCenterActions";
import AdminCrudWorkbench from "@/components/admin/AdminCrudWorkbench";

export default function AdminModelsPage() {
  return (
    <div className="space-y-6">
      <header><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Model registry</p><h1 className="mt-2 font-display text-3xl font-semibold">AI 模型中心</h1><p className="mt-3 text-sm text-text-secondary">Provider、稳定模型别名和分层定价在这里形成一条可审计供应链。</p></header>
      <ModelCenterActions />
      <AdminCrudWorkbench
        resource="providers"
        title="Provider 高级维护"
        description="创建或更新协议端点、凭据、超时与运行状态。Provider 采用停用而非硬删除。"
        createTemplate={{ code: "anthropic-main", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "replace-with-provider-key", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: { authMode: "x-api-key" } }}
        updateTemplate={{ name: "Anthropic", status: "disabled", timeoutMs: 120000, maxRetries: 1, config: { authMode: "x-api-key" } }}
        allowDelete={false}
      />
      <AdminResourceTable resource="providers" title="Providers" description="密钥永不回显；指纹用于核对轮换。" columns={[{ key: "id", label: "Provider ID" }, { key: "code", label: "Code" }, { key: "protocol", label: "协议" }, { key: "base_url", label: "Endpoint" }, { key: "status", label: "状态", format: "status" }, { key: "credential_configured", label: "密钥", format: "boolean" }, { key: "api_key_fingerprint", label: "指纹" }]} />
      <AdminCrudWorkbench
        resource="models"
        title="模型高级维护"
        description="创建模型别名或更新上游型号、能力、上下文和启用状态。"
        createTemplate={{ providerId: "provider_...", code: "claude-sonnet", upstreamModel: "claude-sonnet-4", displayName: "Claude Sonnet", contextWindow: 200000, maxOutputTokens: 8192, capabilities: { streaming: true }, enabled: false }}
        updateTemplate={{ displayName: "Claude Sonnet", contextWindow: 200000, maxOutputTokens: 8192, capabilities: { streaming: true }, enabled: false }}
        allowDelete={false}
      />
      <AdminResourceTable resource="models" title="Model Registry" description="客户端使用 code，上游型号可独立演进。" columns={[{ key: "id", label: "Model ID" }, { key: "code", label: "模型别名" }, { key: "provider_code", label: "Provider" }, { key: "upstream_model", label: "上游型号" }, { key: "context_window", label: "Context" }, { key: "max_output_tokens", label: "Max output" }, { key: "enabled", label: "状态", format: "boolean" }]} />
      <AdminCrudWorkbench
        resource="pricing-rules"
        title="定价规则高级维护"
        description="维护各用户层级的生效时间窗与 Token 单价；冲突时间窗会被拒绝。"
        createTemplate={{ modelId: "model_...", userTier: "default", inputPriceMicrousdPerMillion: 3000000, outputPriceMicrousdPerMillion: 15000000, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0, status: "active", effectiveFrom: "2026-08-08T00:00:00.000Z", effectiveTo: null }}
        updateTemplate={{ inputPriceMicrousdPerMillion: 3000000, outputPriceMicrousdPerMillion: 15000000, status: "active" }}
        allowDelete={false}
      />
      <AdminResourceTable resource="pricing-rules" title="Pricing Rules" description="金额单位为每百万 Token 的 micro-USD；历史请求保存快照。" defaultSort="effective_from" columns={[{ key: "id", label: "Pricing ID" }, { key: "model_code", label: "模型" }, { key: "user_tier", label: "用户等级" }, { key: "input_price_microusd_per_million", label: "Input", format: "money" }, { key: "output_price_microusd_per_million", label: "Output", format: "money" }, { key: "status", label: "状态", format: "status" }, { key: "effective_from", label: "生效时间", format: "date" }]} />
    </div>
  );
}
