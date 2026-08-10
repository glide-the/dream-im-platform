"use client";

import { useCreate } from "@refinedev/core";
import { FormEvent, useState } from "react";

const gatewayScopes = [
  ["messages:create", "Claude Messages"],
  ["chat:create", "OpenAI Chat"],
  ["models:list", "模型列表"],
] as const;

export default function GatewayKeyForm() {
  const create = useCreate<Record<string, unknown>>();
  const [message, setMessage] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const scopes = gatewayScopes
      .map(([scope]) => scope)
      .filter((scope) => form.get(scope) === "on");

    create.mutate(
      {
        resource: "gateway-api-keys",
        values: {
          subjectMode: "canonical_subject",
          serviceClientId: form.get("serviceClientId"),
          name: form.get("name"),
          scopes,
          expiresAt: form.get("expiresAt")
            ? new Date(String(form.get("expiresAt"))).toISOString()
            : null,
        },
      },
      {
        onSuccess: (result) => {
          formElement.reset();
          setPlaintextKey(String(result.data.plaintextKey ?? ""));
          setMessage(
            "Dream 服务 Key 已创建。明文只显示一次，请立即写入服务端 Secret 管理器。",
          );
        },
        onError: (error) => setMessage(error.message),
      },
    );
  }

  return (
    <section className="admin-panel p-5 sm:p-6">
      <div className="border-b border-border pb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
          Canonical-subject service credential
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold">
          发放 Dream 服务 Key
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          该 Key 只标识 Dream 服务；每次推理仍须由 Dream
          服务端签发短期 canonical-subject JWT。浏览器不得持有，数据库只保存哈希。
        </p>
      </div>

      <section
        className="mt-5 border border-border bg-bg-secondary p-4 sm:p-5"
        aria-labelledby="gateway-key-mode-comparison"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            Choose by identity model
          </p>
          <h3
            id="gateway-key-mode-comparison"
            className="mt-1 text-sm font-semibold text-text-primary"
          >
            两种 Key 的业务区别
          </h3>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <article className="border border-border bg-bg-surface p-4">
            <p className="text-[11px] font-semibold text-success">
              当前区域 · Dream 正式链路
            </p>
            <h4 className="mt-1 font-display text-base font-semibold">
              Dream 服务 Key
            </h4>
            <dl className="mt-3 space-y-2 text-xs leading-5">
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-text-tertiary">绑定对象</dt>
                <dd className="text-text-secondary">Dream 服务 Client，不绑定用户</dd>
              </div>
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-text-tertiary">用户身份</dt>
                <dd className="text-text-secondary">
                  每次请求由短期 subject JWT 指定并校验，可安全切换用户
                </dd>
              </div>
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-text-tertiary">适用场景</dt>
                <dd className="text-text-secondary">Dream 多用户、服务到服务的正式流量</dd>
              </div>
            </dl>
          </article>

          <article className="border border-warning/40 bg-accent-orange-light p-4">
            <p className="text-[11px] font-semibold text-text-secondary">
              下方「发放固定用户 Key」 · 兼容入口
            </p>
            <h4 className="mt-1 font-display text-base font-semibold">
              固定用户 Key
            </h4>
            <dl className="mt-3 space-y-2 text-xs leading-5">
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-text-tertiary">绑定对象</dt>
                <dd className="text-text-secondary">
                  创建时绑定一个平台用户，有效期内不能切换
                </dd>
              </div>
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-text-tertiary">用户身份</dt>
                <dd className="text-text-secondary">
                  请求直接继承该固定用户，无需 subject JWT
                </dd>
              </div>
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <dt className="text-text-tertiary">适用场景</dt>
                <dd className="text-text-secondary">
                  Legacy 客户端或单用户隔离调试，不用于 Dream 多用户正式流量
                </dd>
              </div>
            </dl>
          </article>
        </div>

        <p className="mt-4 border-l-2 border-text-primary pl-3 text-xs leading-5 text-text-secondary">
          <strong className="text-text-primary">怎么选：</strong>
          接入 Dream 正式服务，请在本区创建服务 Key；只有明确替某一个用户做兼容或隔离调试时，才使用下方「发放固定用户
          Key」。
        </p>
      </section>

      {plaintextKey ? (
        <div className="mt-5 border border-warning/50 bg-accent-orange-light p-4">
          <p className="text-xs font-semibold text-text-primary">
            仅显示一次 · 仅写入服务端 Secret 管理器
          </p>
          <code className="mt-2 block break-all text-xs">{plaintextKey}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(plaintextKey)}
            className="mt-3 min-h-10 bg-text-primary px-4 text-xs font-semibold text-bg-surface"
          >
            复制密钥
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-text-secondary">
          Service Client ID
          <input
            className="admin-field mt-2 block font-mono text-xs"
            name="serviceClientId"
            defaultValue="dream-bff"
            pattern="[A-Za-z0-9][A-Za-z0-9._:-]*"
            required
          />
        </label>
        <label className="text-xs font-semibold text-text-secondary">
          名称
          <input
            className="admin-field mt-2 block"
            name="name"
            defaultValue="Dream Gateway service"
            required
          />
        </label>
        <label className="text-xs font-semibold text-text-secondary">
          过期时间（可选）
          <input
            className="admin-field mt-2 block"
            name="expiresAt"
            type="datetime-local"
          />
        </label>
        <fieldset className="border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-text-secondary">
            最小 Scopes
          </legend>
          {gatewayScopes.map(([scope, label]) => (
            <label
              key={scope}
              className="mr-4 inline-flex min-h-8 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                name={scope}
                defaultChecked={scope === "messages:create"}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="sm:col-span-2">
          <button className="min-h-11 bg-text-primary px-5 text-sm font-semibold text-bg-surface">
            创建服务 Key 并显示一次
          </button>
        </div>
      </form>
      {message ? (
        <p className="mt-4 text-sm text-text-secondary" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
