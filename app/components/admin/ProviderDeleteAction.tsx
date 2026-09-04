"use client";

// [Input] A safe Provider projection, providers.write permission, and the existing managed-account lifecycle API.
// [Output] One confirmed delete action that preserves dependencies and safely disconnects a managed account first.
// [Pos] Provider deletion interaction; dependency, revision, RBAC, audit, and tombstone rules remain server-owned.
// [Sync] 2026-09-04: add Provider deletion with model/Pricing gates and managed-account revocation.

import { useCan } from "@refinedev/core";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

type ProviderDeleteActionProps = {
  provider: Record<string, unknown>;
  onDeleted: () => void | Promise<void>;
  buttonClassName?: string;
};

type ProviderDeleteDetails = {
  modelCount?: number;
  pricingRuleCount?: number;
};

type ApiResponse = {
  data?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
    details?: ProviderDeleteDetails;
  };
};

type ManagedAuthResponse = {
  data?: {
    resolvedAccount?: {
      accountId?: string;
      credentialId?: string;
      id?: string;
      authEpoch: number;
      revision: number;
    } | null;
    credential?: {
      accountId?: string;
      credentialId?: string;
      id?: string;
      authEpoch: number;
      revision: number;
    } | null;
  };
  error?: ApiResponse["error"];
};

class ProviderDeleteError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: ProviderDeleteDetails,
  ) {
    super(message);
    this.name = "ProviderDeleteError";
  }
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function providerDeleteConflictMessage(details?: ProviderDeleteDetails) {
  const modelCount = count(details?.modelCount);
  const pricingRuleCount = count(details?.pricingRuleCount);
  return `Provider 仍有关联模型或定价（模型 ${modelCount}，Pricing ${pricingRuleCount}）。请先删除 Pricing 和模型。`;
}

export function providerDeleteErrorMessage(error: unknown) {
  if (error instanceof ProviderDeleteError && error.code === "PROVIDER_DELETE_BLOCKED_BY_DEPENDENCIES") {
    return providerDeleteConflictMessage(error.details);
  }
  if (error instanceof Error) return error.message;
  return "删除 Provider 失败，请重试。";
}

async function responseData(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok || !body.data) {
    throw new ProviderDeleteError(
      body.error?.message ?? `请求失败（HTTP ${response.status}）`,
      body.error?.code,
      body.error?.details,
    );
  }
  return body.data;
}

export default function ProviderDeleteAction({
  provider,
  onDeleted,
  buttonClassName,
}: ProviderDeleteActionProps) {
  const access = useCan({ resource: "providers", action: "delete" });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const providerId = String(provider.id ?? "");
  const providerName = String(provider.name ?? "Provider");
  const modelCount = count(provider.model_count);
  const pricingRuleCount = count(provider.pricing_rule_count);
  const managed = provider.adapter_kind !== undefined && provider.adapter_kind !== "generic";

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  if (!access.data?.can || !providerId) return null;

  function close() {
    if (pending) return;
    dialogRef.current?.close();
    setOpen(false);
    setError("");
  }

  async function loadProvider() {
    const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}`, {
      headers: { accept: "application/json" },
    });
    return await responseData(response);
  }

  async function disconnectManagedAccount() {
    const statusResponse = await fetch(
      `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth`,
      { headers: { accept: "application/json" } },
    );
    const statusBody = (await statusResponse.json().catch(() => ({}))) as ManagedAuthResponse;
    if (!statusResponse.ok || !statusBody.data) {
      throw new ProviderDeleteError(
        statusBody.error?.message ?? "无法读取托管账号状态，请重试。",
        statusBody.error?.code,
        statusBody.error?.details,
      );
    }
    const account = statusBody.data.resolvedAccount ?? statusBody.data.credential;
    if (!account) return;
    const accountId = account.accountId ?? account.credentialId ?? account.id;
    if (!accountId) throw new Error("托管账号状态缺少安全引用，请重新加载。");
    const disconnectResponse = await fetch(
      `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/accounts/${encodeURIComponent(accountId)}/disconnect`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          expectedAccountEpoch: account.authEpoch,
          expectedRevision: account.revision,
          reason: "删除 Provider 前安全断开账号",
        }),
      },
    );
    const disconnected = await responseData(disconnectResponse);
    if (["pending", "failed"].includes(String(disconnected.remoteRevocation))) {
      throw new Error("账号已在本地断开，但远端撤销尚未完成。请在设置页重试撤销后再删除 Provider。");
    }
  }

  async function confirmDelete() {
    setPending(true);
    setError("");
    try {
      let latest = await loadProvider();
      const deleteLatest = async () => {
        const expectedDeleteRevision = String(latest.delete_revision ?? "");
        if (!expectedDeleteRevision) throw new Error("Provider 缺少删除版本，请刷新后重试。");
        const response = await fetch(
          `/api/admin/providers/${encodeURIComponent(providerId)}`,
          {
            method: "DELETE",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ expectedDeleteRevision }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as ApiResponse;
        return { response, body };
      };
      let deletion = await deleteLatest();
      if (
        deletion.response.status === 409
        && deletion.body.error?.code === "PROVIDER_DELETE_ACCOUNT_CONNECTED"
        && managed
      ) {
        await disconnectManagedAccount();
        latest = await loadProvider();
        deletion = await deleteLatest();
      }
      if (!deletion.response.ok || !deletion.body.data) {
        throw new ProviderDeleteError(
          deletion.body.error?.message ?? `删除失败（HTTP ${deletion.response.status}）`,
          deletion.body.error?.code,
          deletion.body.error?.details,
        );
      }
      dialogRef.current?.close();
      setOpen(false);
      await onDeleted();
    } catch (caught) {
      setError(providerDeleteErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName ?? "min-h-10 rounded-xl border border-danger/35 px-3 text-xs font-semibold text-danger hover:bg-danger-light"}
      >
        删除 Provider
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="admin-dialog admin-dialog--modal"
          onCancel={(event) => { event.preventDefault(); close(); }}
        >
          <div className="admin-dialog-frame">
            <header className="admin-dialog-header">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-danger">Permanent admin action</p>
                <h2 id={titleId} className="mt-2 font-display text-2xl font-semibold">删除 Provider</h2>
              </div>
              <button type="button" onClick={close} disabled={pending} className="min-h-11 border border-border px-4 text-sm">关闭</button>
            </header>
            <div className="admin-dialog-body space-y-4">
              <p className="text-sm leading-6 text-text-secondary">
                将从管理界面移除 <strong className="text-text-primary">{providerName}</strong>，并阻止新的 Gateway 请求。历史 Usage、计费和审计记录会保留。
              </p>
              <dl className="grid grid-cols-2 border-l border-t border-border">
                <div className="border-b border-r border-border p-4"><dt className="text-xs text-text-tertiary">关联模型</dt><dd className="mt-2 font-mono text-lg font-semibold">{modelCount}</dd></div>
                <div className="border-b border-r border-border p-4"><dt className="text-xs text-text-tertiary">Pricing</dt><dd className="mt-2 font-mono text-lg font-semibold">{pricingRuleCount}</dd></div>
              </dl>
              {modelCount > 0 || pricingRuleCount > 0 ? (
                <p className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary">
                  Provider 仍有关联模型或定价。请先删除 Pricing 和模型，再回来删除 Provider。
                </p>
              ) : managed && provider.managed_credential_id ? (
                <p className="border border-warning/40 bg-accent-orange-light p-4 text-sm leading-6 text-text-secondary">
                  确认后会先安全断开当前托管账号并尝试远端撤销，再删除 Provider。
                </p>
              ) : null}
              {error ? <p className="border border-danger/35 bg-danger-light p-4 text-sm text-danger" role="alert">{error}</p> : null}
              <div className="flex flex-wrap gap-3 text-sm">
                <Link href={`/admin/models/models?provider_id=${encodeURIComponent(providerId)}`} className="underline">查看关联模型</Link>
                <Link href="/admin/models/pricing" className="underline">查看 Pricing</Link>
              </div>
            </div>
            <footer className="admin-dialog-footer">
              <button type="button" onClick={close} disabled={pending} className="min-h-11 border border-border px-4 text-sm">取消</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={pending} className="min-h-11 bg-danger px-5 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? "删除中…" : "确认删除"}
              </button>
            </footer>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
