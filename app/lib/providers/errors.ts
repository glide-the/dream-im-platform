// [Input] Internal configuration, transport, authorization, and response-shape failures.
// [Output] Stable non-secret provider errors safe for DTOs, logs, and audit summaries.
// [Pos] Sanitization boundary shared by every provider product adapter.
// [Sync] 2026-09-04: prevent token, device secret, and upstream body leakage from protocol errors.

import type {
  ProviderErrorCategory,
  ProviderProductKind,
  ProviderRevocationMaterial,
  SafeProviderError,
} from "./types";
import { createProviderRevocationHandoff } from "./types";

export class ProviderProtocolError extends Error {
  readonly code: string;
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(input: {
    code: string;
    category: ProviderErrorCategory;
    message: string;
    retryable?: boolean;
    httpStatus?: number;
  }) {
    super(input.message);
    this.name = "ProviderProtocolError";
    this.code = input.code;
    this.category = input.category;
    this.retryable = input.retryable ?? false;
    this.httpStatus = input.httpStatus;
  }

  toSafeError(): SafeProviderError {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
    };
  }
}

export function safeProviderError(error: unknown): SafeProviderError {
  if (error instanceof ProviderProtocolError) return error.toSafeError();
  return {
    code: "PROVIDER_NETWORK_ERROR",
    category: "network",
    message: "The provider request could not be completed",
    retryable: true,
  };
}

export function operationFailure(
  product: ProviderProductKind,
  error: unknown,
  revocationMaterial?: ProviderRevocationMaterial,
) {
  return {
    status: "failed" as const,
    product,
    error: safeProviderError(error),
    ...(revocationMaterial
      ? { revocationHandoff: createProviderRevocationHandoff(revocationMaterial) }
      : {}),
  };
}

export function configurationError(message: string, code = "PROVIDER_NOT_CONFIGURED") {
  return new ProviderProtocolError({
    code,
    category: "configuration",
    message,
  });
}
