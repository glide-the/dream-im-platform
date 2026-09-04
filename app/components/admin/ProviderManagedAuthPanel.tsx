"use client";

// [Input] A managed Provider id plus its secret-safe account, attempt, readiness, and revocation projections.
// [Output] One Provider account connection, Device guidance, reauthorization, and disconnect actions.
// [Pos] Provider edit-page interaction surface; it never receives tokens or polls an identity provider directly.
// [Sync] 2026-09-04: keep terminal reauthorization history visually subordinate to the still-valid current account.
// [Sync] 2026-09-04: surface post-connect model snapshots and an account-scoped sync retry.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AdapterKind = "codex" | "xai" | "github_copilot";
type AttemptStatus =
  | "starting"
  | "pending"
  | "succeeded"
  | "denied"
  | "expired"
  | "cancelled"
  | "failed";
type AccountStatus = "connected" | "reauth_required" | "disconnected";

export type ManagedProductAccountView = {
  accountId?: string;
  credentialId?: string;
  id?: string;
  adapterKind?: AdapterKind;
  status: AccountStatus;
  authEpoch: number;
  revision: number;
  displayName?: string | null;
  accountLabel: string | null;
  grantedScopes?: string[];
  accessExpiresAt: string | null;
  refreshExpiresAt?: string | null;
  sessionExpiresAt?: string | null;
  registrationCurrent?: boolean;
  usable?: boolean;
  revocationStatus?: string | null;
  disconnectedAt?: string | null;
  updatedAt: string | null;
};

type ManagedAuthAttemptView = {
  id: string;
  status: AttemptStatus;
  revision: number;
  expectedAuthEpoch: number;
  targetAccountId?: string | null;
  userCode: string | null;
  verificationUri: string | null;
  verificationUriComplete: string | null;
  expiresAt: string | null;
  nextPollAt: string | null;
  pollIntervalSeconds: number | null;
  operationLeaseExpiresAt: string | null;
  failureCode: string | null;
  ownedByCurrentAdmin?: boolean;
};

type ManagedAuthRevocationView = {
  id: string;
  accountId?: string;
  managedCredentialId?: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "unsupported";
  revision: number;
  reason: "disconnect" | "replacement" | "activation_rejected" | "renewal_rejected";
  attemptCount: number;
  nextAttemptAt: string | null;
  operationLeaseExpiresAt: string | null;
  failureCode: string | null;
  completedAt: string | null;
  updatedAt: string | null;
};

export type ProviderManagedAuthView = {
  provider: {
    id: string;
    adapterKind: AdapterKind;
    status: "active" | "disabled";
    activeCredentialKind: "managed_oauth" | "none";
    authEpoch: number;
  };
  readiness: {
    codeSupported: boolean;
    clientRegistrationConfigured: boolean;
    integrationProfileConfigured?: boolean;
    encryptionKeyReady: boolean;
    identityPepperReady?: boolean;
    endpointPolicyValid: boolean;
    authorizationReady: boolean;
    credentialConnected: boolean;
    credentialRegistrationCurrent: boolean;
    credentialUsable: boolean;
    copilotAccessVerified?: boolean;
    effective: boolean;
    reasons?: string[];
  };
  resolvedAccount?: ManagedProductAccountView | null;
  credential: ManagedProductAccountView | null;
  attempt: ManagedAuthAttemptView | null;
  latestAttempt?: ManagedAuthAttemptView | null;
  revocation: ManagedAuthRevocationView | null;
};

type ApiResponse<T> = {
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
};

type CatalogSyncResult =
  | {
      status: "succeeded";
      snapshotId: string;
      discoveredCount: number;
      newCount: number;
      conflictCount: number;
      unsupportedCount: number;
      reused: boolean;
    }
  | { status: "failed"; code: string };

class ManagedAuthRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ManagedAuthRequestError";
  }
}

export function managedAuthAutomaticPollDelay(code: string | undefined, status: number) {
  if (code === "PROVIDER_AUTH_POLL_TOO_EARLY" || status === 429) return 1_500;
  if (code === "PROVIDER_AUTH_POLL_IN_PROGRESS" || status === 409) return 5_000;
  return 5_000;
}

const PRODUCT_LABELS: Record<AdapterKind, string> = {
  codex: "Codex / ChatGPT",
  xai: "xAI / Grok",
  github_copilot: "GitHub Copilot",
};

const PRODUCT_LOGIN_LABELS: Record<AdapterKind, string> = {
  codex: "使用 ChatGPT 登录",
  xai: "使用 xAI 登录",
  github_copilot: "使用 GitHub 登录",
};

const TERMINAL_LABELS: Record<AttemptStatus, string> = {
  starting: "正在创建授权",
  pending: "等待账号确认",
  succeeded: "授权完成",
  denied: "授权被拒绝",
  expired: "授权已过期",
  cancelled: "授权已取消",
  failed: "授权失败",
};

export function managedAccountId(account: ManagedProductAccountView) {
  return account.accountId ?? account.credentialId ?? account.id ?? "";
}

export function managedAccountDisplayName(
  account: ManagedProductAccountView,
  productLabel: string,
) {
  const explicit = account.displayName?.trim() || account.accountLabel?.trim();
  if (explicit) return explicit;
  const id = managedAccountId(account);
  return `${productLabel} 账号${id ? ` · ${id.slice(-6)}` : ""}`;
}

export function managedProviderAccount(view: ProviderManagedAuthView) {
  const account = view.resolvedAccount ?? view.credential;
  return account?.status === "disconnected" ? null : account;
}

export function managedAuthAttempt(view: ProviderManagedAuthView) {
  return view.attempt ?? view.latestAttempt ?? null;
}

export function managedAuthAttemptHistoryDescription(
  attempt: ManagedAuthAttemptView,
  hasCurrentAccount: boolean,
) {
  if (hasCurrentAccount && ["denied", "expired", "cancelled", "failed"].includes(attempt.status)) {
    return "本次重新授权未改变当前账号；当前凭据继续有效。";
  }
  return attempt.failureCode;
}

export function managedAuthCountdown(target: string | null, now = Date.now()) {
  if (!target) return null;
  const remaining = Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1_000));
  if (!Number.isFinite(remaining)) return null;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function managedAuthPrimaryAction(view: ProviderManagedAuthView | null, now = Date.now()) {
  if (!view) return { label: "连接账号", enabled: false };
  const attempt = managedAuthAttempt(view);
  if (attempt?.status === "starting") {
    const leaseExpiry = attempt.operationLeaseExpiresAt
      ? new Date(attempt.operationLeaseExpiresAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (leaseExpiry <= now && view.readiness.authorizationReady) {
      return { label: "重新发起授权", enabled: true };
    }
    return { label: "授权进行中", enabled: false };
  }
  if (attempt?.status === "pending") {
    return { label: "授权进行中", enabled: false };
  }
  if (managedProviderAccount(view)) {
    return { label: "重新授权", enabled: view.readiness.authorizationReady };
  }
  return {
    label: PRODUCT_LOGIN_LABELS[view.provider.adapterKind],
    enabled: view.readiness.authorizationReady,
  };
}

export function managedAuthDeploymentRequirements(view: ProviderManagedAuthView) {
  const requirements: string[] = [];
  if (!view.readiness.clientRegistrationConfigured) requirements.push("OAuth 应用注册");
  if (view.readiness.integrationProfileConfigured === false) requirements.push("产品集成身份");
  if (!view.readiness.encryptionKeyReady) requirements.push("凭据加密密钥");
  if (view.readiness.identityPepperReady === false) requirements.push("账号身份保护密钥");
  if (!view.readiness.endpointPolicyValid) requirements.push("可信 Endpoint policy");
  const reasonLabels: Record<string, string> = {
    scopes: "获批 scopes",
    userAgent: "客户端标识",
    issuer: "授权服务器 issuer",
    "integrationProfile.integrationId": "产品集成身份",
    "integrationProfile.editorVersion": "产品集成版本",
    "integrationProfile.editorPluginVersion": "产品插件版本",
    "integrationProfile.apiVersion": "产品 API 版本",
    integrationId: "产品集成身份",
    integrationVersion: "产品集成版本",
    PROVIDER_SCOPE_INVALID: "获批 scopes",
    PROVIDER_HEADER_PROFILE_INVALID: "产品集成配置",
    PROVIDER_CONFIGURATION_INVALID: "产品注册配置",
  };
  for (const reason of view.readiness.reasons ?? []) {
    const label = reasonLabels[reason];
    if (label) requirements.push(label);
  }
  if (!view.readiness.authorizationReady && requirements.length === 0) {
    requirements.push("有效的产品注册配置");
  }
  return [...new Set(requirements)];
}

export function managedAccountStatus(account: Pick<ManagedProductAccountView, "status" | "usable">) {
  if (account.status === "reauth_required") return "需重新认证";
  if (account.status === "disconnected") return "已移除";
  return account.usable === false ? "认证不可用" : "已认证";
}

export function managedAuthAccountStatus(view: ProviderManagedAuthView) {
  const attempt = managedAuthAttempt(view);
  if (attempt?.status === "starting" || attempt?.status === "pending") return "授权进行中";
  if (view.resolvedAccount) return managedAccountStatus(view.resolvedAccount);
  if (view.credential?.status === "connected") {
    return view.readiness.credentialConnected ? "已认证" : "认证不可用";
  }
  if (view.credential?.status === "reauth_required") return "需重新认证";
  return "未认证";
}

export function managedAuthCanRetryRevocation(
  revocation: ProviderManagedAuthView["revocation"],
  now = Date.now(),
) {
  if (!revocation) return false;
  if (revocation.status === "pending" || revocation.status === "failed") return true;
  return revocation.status === "processing"
    && Boolean(revocation.operationLeaseExpiresAt)
    && new Date(revocation.operationLeaseExpiresAt as string).getTime() <= now;
}

export function managedAuthStartBody(
  view: ProviderManagedAuthView,
  account?: ManagedProductAccountView,
  idempotencyKey = crypto.randomUUID(),
) {
  return {
    expectedAuthEpoch: view.provider.authEpoch,
    idempotencyKey,
    ...(account
      ? {
          targetAccountId: managedAccountId(account),
          expectedAccountEpoch: account.authEpoch,
        }
      : {}),
  };
}

export function managedAuthDisconnectBody(
  account: ManagedProductAccountView,
) {
  return {
    expectedAccountEpoch: account.authEpoch,
    expectedRevision: account.revision,
  };
}

function ReadinessItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="border border-border bg-bg-secondary/45 p-3">
      <p className="text-[11px] text-text-tertiary">{label}</p>
      <p className={`mt-1 text-xs font-semibold ${ready ? "text-success" : "text-accent-orange"}`}>
        {ready ? "就绪" : "未就绪"}
      </p>
    </div>
  );
}

type ManagedAction =
  | { kind: "connect" }
  | { kind: "reauth"; account: ManagedProductAccountView }
  | { kind: "poll"; automatic?: boolean }
  | { kind: "cancel" }
  | { kind: "disconnect"; account: ManagedProductAccountView }
  | { kind: "retry-revocation" }
  | { kind: "sync-models" };

export default function ProviderManagedAuthPanel({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [view, setView] = useState<ProviderManagedAuthView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const actionInFlight = useRef(false);
  const automaticPollNotBefore = useRef(0);

  const request = useCallback(async <T,>(url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as ApiResponse<T>;
    if (!response.ok || body.data === undefined) {
      throw new ManagedAuthRequestError(
        body.error?.message ?? `请求失败（HTTP ${response.status}）`,
        body.error?.code,
        response.status,
        body.error?.details,
      );
    }
    return body.data;
  }, []);

  const refresh = useCallback(async () => {
    const data = await request<ProviderManagedAuthView>(
      `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/status`,
    );
    setView(data);
    return data;
  }, [providerId, request]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    request<ProviderManagedAuthView>(
      `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/status`,
      { signal: controller.signal },
    )
      .then(setView)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "认证状态加载失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [providerId, request]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const run = useCallback(async (action: ManagedAction) => {
    if (!view || pendingAction || actionInFlight.current) return;
    const attempt = managedAuthAttempt(view);
    const actionAccount = "account" in action ? managedAccountId(action.account) : "";
    const actionKey = `${action.kind}${actionAccount ? `:${actionAccount}` : ""}`;
    actionInFlight.current = true;
    setPendingAction(actionKey);
    setError("");
    if (!(action.kind === "poll" && action.automatic)) setMessage("");
    try {
      if (action.kind === "connect" || action.kind === "reauth") {
        const target = action.kind === "reauth" ? action.account : null;
        await request(
          `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/start`,
          {
            method: "POST",
            body: JSON.stringify(managedAuthStartBody(view, target ?? undefined)),
          },
        );
        setMessage(target
          ? "重新授权已创建；验证成功前，当前有效凭据会继续服务。"
          : "授权已创建，请在验证页面确认账号。完成后本页会自动检查结果。");
      } else if (action.kind === "poll" && attempt) {
        const result = await request<{
          status: string;
          credentialStatus?: string;
          catalogSync?: CatalogSyncResult;
        }>(
          `/api/admin/provider-auth-attempts/${encodeURIComponent(attempt.id)}/poll`,
          { method: "POST", body: JSON.stringify({ expectedRevision: attempt.revision }) },
        );
        if (result.catalogSync?.status === "succeeded") {
          setMessage(
            `账号已连接，已获取 ${result.catalogSync.discoveredCount} 个可用模型；请确认差异后应用。`,
          );
          router.push(
            `/admin/models/providers/${encodeURIComponent(providerId)}/discover/${encodeURIComponent(result.catalogSync.snapshotId)}`,
          );
        } else if (result.catalogSync?.status === "failed") {
          setMessage("账号已连接，但模型目录自动同步未完成；可点击“同步模型”重试。");
        }
      } else if (action.kind === "cancel" && attempt) {
        await request(
          `/api/admin/provider-auth-attempts/${encodeURIComponent(attempt.id)}/cancel`,
          { method: "POST", body: JSON.stringify({ expectedRevision: attempt.revision }) },
        );
        setMessage("本次授权已取消，临时授权信息已清除。");
      } else if (action.kind === "disconnect") {
        if (!window.confirm("断开后会立即清除此 Provider 的账号凭据，Provider 将无法处理请求。确认继续吗？")) return;
        const result = await request<{ remoteRevocation: string }>(
          `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/accounts/${encodeURIComponent(managedAccountId(action.account))}/disconnect`,
          {
            method: "POST",
            body: JSON.stringify(managedAuthDisconnectBody(action.account)),
          },
        );
        setMessage(result.remoteRevocation === "succeeded"
          ? "账号已断开，远端凭据也已撤销。"
          : "账号已断开；远端撤销结果已准确记录。");
      } else if (action.kind === "retry-revocation" && view.revocation) {
        const accountId = view.revocation.accountId ?? view.revocation.managedCredentialId;
        if (!accountId) throw new Error("撤销记录缺少账号引用，请重新加载后重试。");
        const result = await request<{ status: string }>(
          `/api/admin/providers/${encodeURIComponent(providerId)}/managed-auth/revocations/retry`,
          {
            method: "POST",
            body: JSON.stringify({
              jobId: view.revocation.id,
              accountId,
              expectedRevision: view.revocation.revision,
            }),
          },
        );
        setMessage(result.status === "succeeded"
          ? "远端凭据已撤销。"
          : result.status === "unsupported"
            ? "当前产品注册不支持远端撤销；本地账号仍保持移除。"
            : "撤销仍未完成，已保留加密材料，可稍后再次重试。");
      } else if (action.kind === "sync-models") {
        const result = await request<{
          id: string;
          discoveredCount: number;
        }>(`/api/admin/providers/${encodeURIComponent(providerId)}/discover`, {
          method: "POST",
        });
        setMessage(`已获取 ${result.discoveredCount} 个可用模型；请确认差异后应用。`);
        router.push(
          `/admin/models/providers/${encodeURIComponent(providerId)}/discover/${encodeURIComponent(result.id)}`,
        );
      }
      await refresh();
    } catch (caught) {
      if (action.kind === "poll" && action.automatic) {
        const delay = caught instanceof ManagedAuthRequestError
          ? managedAuthAutomaticPollDelay(caught.code, caught.status)
          : 5_000;
        automaticPollNotBefore.current = Date.now() + delay;
        if (!(caught instanceof ManagedAuthRequestError)
          || !["PROVIDER_AUTH_POLL_TOO_EARLY", "PROVIDER_AUTH_POLL_IN_PROGRESS"].includes(caught.code ?? "")) {
          setMessage("");
          setError(caught instanceof Error ? caught.message : "认证操作失败");
        }
        await refresh().catch(() => undefined);
      } else {
        setError(caught instanceof Error ? caught.message : "认证操作失败");
      }
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  }, [pendingAction, providerId, refresh, request, router, view]);

  const attempt = view ? managedAuthAttempt(view) : null;
  const nextPollCountdown = managedAuthCountdown(attempt?.nextPollAt ?? null, clock);
  const expiresCountdown = managedAuthCountdown(attempt?.expiresAt ?? null, clock);
  const readyToPoll = Boolean(
    attempt?.status === "pending"
    && attempt.ownedByCurrentAdmin !== false
    && attempt.nextPollAt
    && new Date(attempt.nextPollAt).getTime() <= clock
    && automaticPollNotBefore.current <= clock,
  );

  useEffect(() => {
    if (!readyToPoll || pendingAction) return;
    void run({ kind: "poll", automatic: true });
  }, [pendingAction, readyToPoll, run]);

  const primary = useMemo(() => managedAuthPrimaryAction(view, clock), [clock, view]);
  if (loading) {
    return <section className="rounded-2xl border border-border bg-bg-surface p-5" aria-busy="true">正在读取产品认证状态…</section>;
  }
  if (!view) {
    return <section className="rounded-2xl border border-danger/35 bg-danger-light p-5 text-sm text-danger" role="alert">{error || "产品认证状态不可用"}</section>;
  }

  const currentAccount = managedProviderAccount(view);
  const currentAccountId = currentAccount ? managedAccountId(currentAccount) : "";
  const primaryAction: ManagedAction = currentAccount
    ? { kind: "reauth", account: currentAccount }
    : { kind: "connect" };
  const primaryActionKey = currentAccount ? `reauth:${currentAccountId}` : "connect";
  const attemptActive = attempt?.status === "starting" || attempt?.status === "pending";
  const attemptHistoryDescription = attempt
    ? managedAuthAttemptHistoryDescription(attempt, Boolean(currentAccount))
    : null;
  const deploymentRequirements = managedAuthDeploymentRequirements(view);

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 sm:p-6" aria-labelledby="provider-managed-auth-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Provider account</p>
          <h2 id="provider-managed-auth-title" className="mt-2 font-display text-xl font-semibold">
            此 Provider 的 {PRODUCT_LABELS[view.provider.adapterKind]} 账号
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            一个 Provider 只连接一个账号。若要接入同一产品的其他账号，请新建 Provider。凭据只在服务端加密保存。
          </p>
        </div>
        <span className={`border px-3 py-1.5 text-xs font-semibold ${view.readiness.effective ? "border-success/35 bg-success-light text-success" : "border-warning/40 bg-accent-orange-light text-accent-orange"}`}>
          {view.readiness.effective
            ? "认证可用于 Gateway"
            : currentAccount && view.provider.status !== "active"
              ? "账号已连接 · Provider 尚未启用"
              : "尚未生效"}
        </span>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="运行就绪检查">
        <ReadinessItem label="代码能力" ready={view.readiness.codeSupported} />
        <ReadinessItem label="产品配置" ready={view.readiness.clientRegistrationConfigured && view.readiness.integrationProfileConfigured !== false} />
        <ReadinessItem label="加密能力" ready={view.readiness.encryptionKeyReady && view.readiness.identityPepperReady !== false} />
        <ReadinessItem label="Endpoint policy" ready={view.readiness.endpointPolicyValid} />
        <ReadinessItem label="当前账号" ready={view.readiness.effective} />
      </div>

      {!view.readiness.authorizationReady ? (
        <p id="managed-auth-deployment-requirements" className="mt-4 border border-warning/40 bg-accent-orange-light p-4 text-xs leading-5 text-text-secondary" role="status">
          <span className="font-semibold text-accent-orange">认证前置未就绪：</span>
          还需{deploymentRequirements.join("、")}。服务端当前保持 fail closed。
        </p>
      ) : null}

      <section className="mt-5 border border-border bg-bg-secondary/35 p-4 sm:p-5" aria-labelledby="managed-provider-account-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="managed-provider-account-title" className="font-display text-lg font-semibold">连接账号</h3>
            <p className="mt-1 text-xs leading-5 text-text-tertiary">授权、重新授权和断开都只影响此 Provider。</p>
          </div>
          <button
            type="button"
            disabled={!primary.enabled || Boolean(pendingAction)}
            onClick={() => void run(primaryAction)}
            aria-describedby={!view.readiness.authorizationReady ? "managed-auth-deployment-requirements" : undefined}
            className="min-h-11 border border-border bg-bg-surface px-4 text-sm font-semibold hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingAction === primaryActionKey ? "正在创建…" : primary.label}
          </button>
        </div>
        {currentAccount ? (
          <div className="mt-4 border border-border bg-bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-tertiary">账号</p>
                <p className="mt-1 truncate text-sm font-semibold">
                  {managedAccountDisplayName(currentAccount, PRODUCT_LABELS[view.provider.adapterKind])}
                </p>
                <p className={`mt-2 text-xs ${managedAccountStatus(currentAccount) === "已认证" ? "text-success" : "text-accent-orange"}`} role="status">
                  {managedAccountStatus(currentAccount)}
                  {currentAccount.accessExpiresAt
                    ? ` · 访问凭据到期 ${new Date(currentAccount.accessExpiresAt).toLocaleString("zh-CN")}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void run({ kind: "sync-models" })}
                  className="min-h-10 border border-accent/35 bg-accent-light px-3 text-xs font-semibold text-accent disabled:opacity-40"
                >
                  {pendingAction === "sync-models" ? "同步中…" : "同步模型"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void run({ kind: "disconnect", account: currentAccount })}
                  className="min-h-10 border border-danger/40 px-3 text-xs font-semibold text-danger disabled:opacity-40"
                >
                  {pendingAction === `disconnect:${currentAccountId}` ? "断开中…" : "断开账号"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 border border-dashed border-border bg-bg-subtle p-5 text-sm text-text-secondary">
            此 Provider 尚未连接账号。完成授权后，账号会固定显示在这里。
          </p>
        )}

        <p className="mt-4 text-xs text-text-tertiary">
          需要接入另一个 {PRODUCT_LABELS[view.provider.adapterKind]} 账号？
          <Link className="ml-1 font-semibold text-accent underline underline-offset-2" href="/admin/models/providers/new">
            新建 Provider
          </Link>
        </p>
      </section>

      {attempt && !attemptActive ? (
        <div className="mt-4 border border-border p-4">
          <p className="text-xs text-text-tertiary">
            {currentAccount && attempt.status !== "succeeded" ? "最近一次重新授权" : "最近一次授权"}
          </p>
          <p className="mt-2 text-sm font-semibold">{TERMINAL_LABELS[attempt.status]}</p>
          {attemptHistoryDescription ? (
            <p className={`mt-2 text-xs ${currentAccount ? "text-text-secondary" : "font-mono text-[11px] text-danger"}`}>
              {attemptHistoryDescription}
            </p>
          ) : null}
        </div>
      ) : null}

      {attempt?.status === "pending" && attempt.ownedByCurrentAdmin !== false ? (
        <div className="mt-4 border border-accent/30 bg-accent-light p-4">
          <p className="text-xs font-semibold text-text-secondary">在产品验证页输入用户码</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="border border-border bg-bg-surface px-4 py-3 font-mono text-xl font-semibold tracking-[0.16em]">{attempt.userCode ?? "—"}</code>
            {attempt.userCode ? (
              <button type="button" className="min-h-11 border border-border bg-bg-surface px-4 text-sm" onClick={() => void navigator.clipboard.writeText(attempt.userCode!)}>复制用户码</button>
            ) : null}
            {attempt.verificationUri ? (
              <a className="inline-flex min-h-11 items-center bg-accent px-4 text-sm font-semibold text-white" href={attempt.verificationUriComplete ?? attempt.verificationUri} target="_blank" rel="noreferrer">打开验证页面</a>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-text-tertiary">
            {readyToPoll ? "正在检查授权结果…" : `下次检查 ${nextPollCountdown ?? "—"} · 授权剩余 ${expiresCountdown ?? "—"}`}
          </p>
        </div>
      ) : null}

      {attempt?.status === "pending" && attempt.ownedByCurrentAdmin === false ? (
        <p className="mt-4 border border-border bg-bg-subtle p-4 text-sm text-text-secondary">该授权由另一位管理员发起；用户码与验证地址仅对发起人可见。</p>
      ) : null}

      {attempt?.status === "starting" && attempt.operationLeaseExpiresAt
        && new Date(attempt.operationLeaseExpiresAt).getTime() <= clock ? (
        <p className="mt-4 border border-warning/40 bg-accent-orange-light p-4 text-sm text-text-secondary" role="status">创建授权的服务端操作已超时，可以重新发起；旧结果不会覆盖当前状态。</p>
      ) : null}

      {view.revocation && ["pending", "processing", "failed"].includes(view.revocation.status) ? (
        <div className="mt-4 border border-warning/40 bg-accent-orange-light p-4" role="status">
          <p className="text-sm font-semibold text-text-primary">远端凭据撤销尚未完成</p>
          <p className="mt-1 text-xs leading-5 text-text-secondary">本地账号已经移除；撤销材料仍以密文保存。失败码：{view.revocation.failureCode ?? "等待处理"}</p>
          {managedAuthCanRetryRevocation(view.revocation, clock) ? (
            <button type="button" disabled={Boolean(pendingAction)} onClick={() => void run({ kind: "retry-revocation" })} className="mt-3 min-h-10 border border-warning/50 px-3 text-xs font-semibold disabled:opacity-40">
              {pendingAction === "retry-revocation" ? "正在重试…" : view.revocation.status === "processing" ? "恢复远端撤销" : "重试远端撤销"}
            </button>
          ) : null}
        </div>
      ) : null}

      {attemptActive && attempt?.ownedByCurrentAdmin !== false ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {attempt.status === "pending" ? (
            <button type="button" disabled={!readyToPoll || Boolean(pendingAction)} onClick={() => void run({ kind: "poll" })} className="min-h-11 border border-border px-4 text-sm disabled:opacity-40">
              {pendingAction === "poll" ? "检查中…" : "立即检查"}
            </button>
          ) : null}
          <button type="button" disabled={Boolean(pendingAction)} onClick={() => void run({ kind: "cancel" })} className="min-h-11 border border-border px-4 text-sm disabled:opacity-40">
            {pendingAction === "cancel" ? "取消中…" : "取消本次授权"}
          </button>
        </div>
      ) : null}

      {message ? <p className="mt-4 border border-success/35 bg-success-light p-3 text-sm text-success" role="status">{message}</p> : null}
      {error ? <p className="mt-4 border border-danger/35 bg-danger-light p-3 text-sm text-danger" role="alert">{error}</p> : null}
    </section>
  );
}
