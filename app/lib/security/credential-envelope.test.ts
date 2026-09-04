// [Input] Deterministic test keys, credential payload codecs, and managed-record AAD contexts.
// [Output] Regression coverage for envelope round-trips and fail-closed context/payload validation.
// [Pos] Unit contract for the managed Provider credential encryption primitive.
// [Sync] 2026-09-04: cover versioned AES-GCM payload, AAD/revision fencing, and malformed payload rejection.
import { describe, expect, it } from "vitest";

import {
  CredentialEnvelopeError,
  decryptCredentialEnvelope,
  encryptCredentialEnvelope,
  type CredentialEnvelopeSchema,
} from "./credential-envelope";

type TokenBundle = Readonly<{
  accessToken: string;
  refreshToken: string;
}>;

const tokenBundleSchema: CredentialEnvelopeSchema<TokenBundle> = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "accessToken,refreshToken" ||
      typeof (value as Record<string, unknown>).accessToken !== "string" ||
      typeof (value as Record<string, unknown>).refreshToken !== "string"
    ) {
      throw new TypeError("invalid token bundle");
    }
    return value as TokenBundle;
  },
};

const permissiveSchema: CredentialEnvelopeSchema<unknown> = {
  parse(value) {
    return value;
  },
};

const key = { key: Buffer.alloc(32, 11), keyId: "test-key-v1" };
const context = {
  providerId: "provider-1",
  adapterKind: "codex" as const,
  recordKind: "credential" as const,
  recordId: "credential-1",
  revision: 4,
};

describe("managed credential envelope", () => {
  it("round-trips a strictly validated payload without exposing plaintext", () => {
    const payload = {
      accessToken: "access-sensitive",
      refreshToken: "refresh-sensitive",
    };
    const encrypted = encryptCredentialEnvelope(
      payload,
      context,
      tokenBundleSchema,
      key,
    );

    expect(encrypted).toMatchObject({
      formatVersion: 1,
      keyId: "test-key-v1",
    });
    expect(JSON.stringify(encrypted)).not.toContain("sensitive");
    expect(
      decryptCredentialEnvelope(encrypted, context, tokenBundleSchema, key),
    ).toEqual(payload);
  });

  it("fails closed when any AAD identity or revision changes", () => {
    const encrypted = encryptCredentialEnvelope(
      { accessToken: "a", refreshToken: "r" },
      context,
      tokenBundleSchema,
      key,
    );

    for (const changedContext of [
      { ...context, providerId: "provider-2" },
      { ...context, adapterKind: "xai" as const },
      { ...context, recordKind: "attempt" as const },
      { ...context, recordKind: "revocation_job" as const },
      { ...context, recordId: "credential-2" },
      { ...context, revision: 5 },
    ]) {
      expect(() =>
        decryptCredentialEnvelope(
          encrypted,
          changedContext,
          tokenBundleSchema,
          key,
        ),
      ).toThrowError(
        expect.objectContaining<Partial<CredentialEnvelopeError>>({
          code: "CREDENTIAL_ENVELOPE_AUTHENTICATION_FAILED",
        }),
      );
    }
  });

  it("round-trips a revocation-job envelope with distinct AAD", () => {
    const jobContext = {
      ...context,
      recordKind: "revocation_job" as const,
      recordId: "revocationjob-1",
      revision: 1,
    };
    const encrypted = encryptCredentialEnvelope(
      { accessToken: "access-sensitive", refreshToken: "refresh-sensitive" },
      jobContext,
      tokenBundleSchema,
      key,
    );
    expect(decryptCredentialEnvelope(
      encrypted,
      jobContext,
      tokenBundleSchema,
      key,
    )).toEqual({
      accessToken: "access-sensitive",
      refreshToken: "refresh-sensitive",
    });
  });

  it("rejects a valid envelope whose decrypted payload violates the codec", () => {
    const encrypted = encryptCredentialEnvelope(
      { unexpected: "shape" },
      context,
      permissiveSchema,
      key,
    );

    expect(() =>
      decryptCredentialEnvelope(encrypted, context, tokenBundleSchema, key),
    ).toThrowError(
      expect.objectContaining<Partial<CredentialEnvelopeError>>({
        code: "CREDENTIAL_ENVELOPE_PAYLOAD_INVALID",
      }),
    );
  });
});
