"use client";

import { useCreate } from "@refinedev/core";
import { useState } from "react";

const inputClass =
  "min-h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-sm outline-none focus:border-accent";

function feedback(error: unknown, success: string) {
  return error instanceof Error ? error.message : success;
}

export default function ModelCenterActions() {
  const provider = useCreate();
  const model = useCreate();
  const pricing = useCreate();
  const [message, setMessage] = useState("");

  function createProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    provider.mutate(
      {
        resource: "providers",
        values: {
          code: form.get("code"),
          name: form.get("name"),
          protocol: form.get("protocol"),
          baseUrl: form.get("baseUrl"),
          apiKey: form.get("apiKey"),
          status: form.get("status"),
          timeoutMs: Number(form.get("timeoutMs")),
          maxRetries: Number(form.get("maxRetries")),
          config: {
            authMode: form.get("authMode"),
          },
        },
      },
      {
        onSuccess: () => {
          formElement.reset();
          setMessage("Provider 已创建；密钥只以密文保存。 ");
        },
        onError: (error) => setMessage(feedback(error, "Provider 创建失败")),
      },
    );
  }

  function createModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    model.mutate(
      {
        resource: "models",
        values: {
          providerId: form.get("providerId"),
          code: form.get("code"),
          upstreamModel: form.get("upstreamModel"),
          displayName: form.get("displayName"),
          contextWindow: Number(form.get("contextWindow")) || null,
          maxOutputTokens: Number(form.get("maxOutputTokens")) || null,
          capabilities: { chat: true, streaming: true },
          enabled: form.get("enabled") === "on",
        },
      },
      {
        onSuccess: () => {
          formElement.reset();
          setMessage("模型别名已创建。");
        },
        onError: (error) => setMessage(feedback(error, "模型创建失败")),
      },
    );
  }

  function createPricing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const effectiveFrom = new Date(String(form.get("effectiveFrom"))).toISOString();
    pricing.mutate(
      {
        resource: "pricing-rules",
        values: {
          modelId: form.get("modelId"),
          userTier: form.get("userTier"),
          inputPriceMicrousdPerMillion: Number(form.get("inputPrice")),
          outputPriceMicrousdPerMillion: Number(form.get("outputPrice")),
          cacheReadPriceMicrousdPerMillion: Number(form.get("cacheReadPrice")),
          cacheWritePriceMicrousdPerMillion: Number(form.get("cacheWritePrice")),
          markupBps: Number(form.get("markupBps")),
          discountBps: Number(form.get("discountBps")),
          status: "active",
          effectiveFrom,
          effectiveTo: null,
        },
      },
      {
        onSuccess: () => {
          formElement.reset();
          setMessage("定价规则已生效。");
        },
        onError: (error) => setMessage(feedback(error, "定价创建失败")),
      },
    );
  }

  return (
    <section className="rounded-[24px] border border-border bg-bg-surface p-5 shadow-subtle sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
            controlled mutations
          </p>
          <h2 className="mt-2 text-lg font-semibold">配置模型供应链</h2>
        </div>
        {message ? <p className="text-sm text-text-secondary">{message}</p> : null}
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <details className="rounded-2xl border border-border p-4" open>
          <summary className="cursor-pointer font-semibold">新增 Provider</summary>
          <form className="mt-4 space-y-3" onSubmit={createProvider}>
            <input className={inputClass} name="code" placeholder="anthropic-primary" required />
            <input className={inputClass} name="name" placeholder="Anthropic Primary" required />
            <select className={inputClass} name="protocol"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
            <input className={inputClass} name="baseUrl" type="url" placeholder="https://api.anthropic.com" required />
            <input className={inputClass} name="apiKey" type="password" autoComplete="new-password" placeholder="Provider API Key（不回显）" required />
            <select className={inputClass} name="authMode">
              <option value="x-api-key">x-api-key（Anthropic 官方）</option>
              <option value="bearer">Authorization Bearer（Claude 中转）</option>
            </select>
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="timeoutMs" type="number" defaultValue="120000" /><input className={inputClass} name="maxRetries" type="number" defaultValue="1" /></div>
            <select className={inputClass} name="status"><option value="disabled">先禁用</option><option value="active">立即启用</option></select>
            <button className="min-h-11 w-full rounded-full bg-text-primary text-sm font-semibold text-bg-surface">保存 Provider</button>
          </form>
        </details>
        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer font-semibold">新增模型映射</summary>
          <form className="mt-4 space-y-3" onSubmit={createModel}>
            <input className={inputClass} name="providerId" placeholder="Provider ID" required />
            <input className={inputClass} name="code" placeholder="claude-writing" required />
            <input className={inputClass} name="upstreamModel" placeholder="claude-sonnet-4-..." required />
            <input className={inputClass} name="displayName" placeholder="Claude Writing" required />
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="contextWindow" type="number" placeholder="Context" /><input className={inputClass} name="maxOutputTokens" type="number" placeholder="Max output" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" /> 创建后启用</label>
            <button className="min-h-11 w-full rounded-full bg-text-primary text-sm font-semibold text-bg-surface">保存模型</button>
          </form>
        </details>
        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer font-semibold">新增定价规则</summary>
          <form className="mt-4 space-y-3" onSubmit={createPricing}>
            <input className={inputClass} name="modelId" placeholder="Model ID" required />
            <input className={inputClass} name="userTier" defaultValue="default" required />
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="inputPrice" type="number" placeholder="Input microUSD/M" required /><input className={inputClass} name="outputPrice" type="number" placeholder="Output microUSD/M" required /></div>
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="cacheReadPrice" type="number" defaultValue="0" placeholder="Cache read" /><input className={inputClass} name="cacheWritePrice" type="number" defaultValue="0" placeholder="Cache write" /></div>
            <div className="grid grid-cols-2 gap-3"><input className={inputClass} name="markupBps" type="number" defaultValue="0" placeholder="Markup bps" /><input className={inputClass} name="discountBps" type="number" defaultValue="0" placeholder="Discount bps" /></div>
            <input className={inputClass} name="effectiveFrom" type="datetime-local" required />
            <button className="min-h-11 w-full rounded-full bg-text-primary text-sm font-semibold text-bg-surface">发布定价</button>
          </form>
        </details>
      </div>
    </section>
  );
}
