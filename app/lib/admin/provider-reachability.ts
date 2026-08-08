import type { PoolClient } from "pg";

import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

type ProviderProtocol = "anthropic" | "openai";

type ProviderReachabilityRow = {
  id: string;
  code: string;
  name: string;
  protocol: ProviderProtocol;
  base_url: string;
};

export type ProviderReachabilityResult = {
  status: "operational" | "degraded" | "failed";
  reachable: boolean;
  responseTimeMs: number | null;
  httpStatus: number | null;
  testedAt: string;
  message: string;
};

type ReachabilityFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "status">>;

const PROBE_TIMEOUT_MS = 8_000;
const DEGRADED_THRESHOLD_MS = 6_000;

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Mirrors cc-switch reachability checks: any HTTP response proves that the
 * endpoint is reachable. This intentionally does not validate credentials or
 * models and never sends a model-generation request.
 */
export async function probeProviderReachability(
  input: { protocol: ProviderProtocol; baseUrl: string },
  dependencies: {
    fetcher?: ReachabilityFetch;
    now?: () => number;
    testedAt?: () => Date;
    timeoutMs?: number;
  } = {},
): Promise<ProviderReachabilityResult> {
  const baseUrl = resolveProviderBaseUrl(input);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const testedAt = dependencies.testedAt ?? (() => new Date());
  const timeoutMs = dependencies.timeoutMs ?? PROBE_TIMEOUT_MS;
  const startedAt = now();

  try {
    const response = await fetcher(baseUrl, {
      method: "GET",
      headers: {
        accept: "*/*",
        "accept-encoding": "identity",
        "user-agent": "Ink-Memory-Admin/Provider-Reachability",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const responseTimeMs = Math.max(0, now() - startedAt);
    const status =
      responseTimeMs > DEGRADED_THRESHOLD_MS ? "degraded" : "operational";
    return {
      status,
      reachable: true,
      responseTimeMs,
      httpStatus: response.status,
      testedAt: testedAt().toISOString(),
      message:
        status === "degraded"
          ? "Provider 可达，但响应头延迟较高"
          : "Provider 网络可达",
    };
  } catch (error) {
    return {
      status: "failed",
      reachable: false,
      responseTimeMs: null,
      httpStatus: null,
      testedAt: testedAt().toISOString(),
      message: isAbortError(error)
        ? "Provider 连通性检查超时"
        : "Provider 无法建立网络连接",
    };
  }
}

async function loadProvider(client: PoolClient, providerId: string) {
  const { rows } = await client.query<ProviderReachabilityRow>(
    `SELECT id, code, name, protocol, base_url
     FROM ai_providers
     WHERE id = $1`,
    [providerId],
  );
  if (!rows[0]) {
    throw new AdminError(
      "ADMIN_RESOURCE_ITEM_NOT_FOUND",
      "The requested provider does not exist",
      404,
    );
  }
  return rows[0];
}

export async function handleProviderReachability(
  request: Request,
  providerId: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "providers.write");
    const provider = await withPlatformClient((client) =>
      loadProvider(client, providerId),
    );
    const data = await probeProviderReachability({
      protocol: provider.protocol,
      baseUrl: provider.base_url,
    });

    await withPlatformTransaction(async (client) => {
      await recordAdminAuditOnClient(client, {
        identity,
        action: "reachability_check",
        resourceType: "providers",
        resourceId: provider.id,
        requestId,
        request,
        metadata: {
          providerCode: provider.code,
          status: data.status,
          reachable: data.reachable,
          responseTimeMs: data.responseTimeMs,
          httpStatus: data.httpStatus,
        },
      });
    });

    return Response.json(
      { data },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
