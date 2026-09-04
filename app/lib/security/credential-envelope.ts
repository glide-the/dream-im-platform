// [Input] A managed Provider credential/attempt payload, its immutable record context, and the shared credential key.
// [Output] Versioned AES-256-GCM envelope fields, or a strictly validated decrypted payload.
// [Pos] Security primitive for product-account Provider auth; separate from legacy static API-key encryption.
// [Sync] 2026-09-04: bind managed secrets to provider, adapter, record kind/id, and revision through authenticated AAD.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import {
  CredentialConfigurationError,
  getCredentialEncryptionKey,
} from "./credential-encryption";

export const CREDENTIAL_ENVELOPE_FORMAT_VERSION = 1 as const;

export type ManagedCredentialAdapterKind =
  | "codex"
  | "xai"
  | "github_copilot";

export type CredentialEnvelopeRecordKind =
  | "credential"
  | "attempt"
  | "revocation_job";

export type CredentialEnvelopeContext = Readonly<{
  providerId: string;
  adapterKind: ManagedCredentialAdapterKind;
  recordKind: CredentialEnvelopeRecordKind;
  recordId: string;
  revision: number;
}>;

export type EncryptedCredentialEnvelope = Readonly<{
  formatVersion: typeof CREDENTIAL_ENVELOPE_FORMAT_VERSION;
  keyId: string;
  ciphertext: string;
  nonce: string;
  tag: string;
}>;

export type CredentialEnvelopeSchema<T> = Readonly<{
  parse(value: unknown): T;
}>;

export type CredentialEnvelopeKey = Readonly<{
  key: Uint8Array;
  keyId?: string;
}>;

export type CredentialEnvelopeErrorCode =
  | "CREDENTIAL_ENVELOPE_CONTEXT_INVALID"
  | "CREDENTIAL_ENVELOPE_UNSUPPORTED_VERSION"
  | "CREDENTIAL_ENVELOPE_KEY_MISMATCH"
  | "CREDENTIAL_ENVELOPE_MALFORMED"
  | "CREDENTIAL_ENVELOPE_AUTHENTICATION_FAILED"
  | "CREDENTIAL_ENVELOPE_PAYLOAD_INVALID";

export class CredentialEnvelopeError extends Error {
  constructor(
    readonly code: CredentialEnvelopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CredentialEnvelopeError";
  }
}

function assertContext(
  context: CredentialEnvelopeContext,
): CredentialEnvelopeContext {
  if (
    !context.providerId.trim() ||
    !context.recordId.trim() ||
    !Number.isSafeInteger(context.revision) ||
    context.revision < 1 ||
    !["codex", "xai", "github_copilot"].includes(context.adapterKind) ||
    !["credential", "attempt", "revocation_job"].includes(context.recordKind)
  ) {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_CONTEXT_INVALID",
      "Credential envelope context is invalid",
    );
  }
  return context;
}

function resolveKey(material?: CredentialEnvelopeKey) {
  const key = Buffer.from(material?.key ?? getCredentialEncryptionKey());
  if (key.length !== 32) {
    throw new CredentialConfigurationError("Credential key must be 32 bytes");
  }

  const derivedKeyId = `sha256:${createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 16)}`;
  const keyId =
    material?.keyId ??
    (process.env.AI_CREDENTIAL_ENCRYPTION_KEY_ID?.trim() || derivedKeyId);
  if (!keyId.trim()) {
    throw new CredentialConfigurationError(
      "Credential envelope key id must not be empty",
    );
  }
  return { key, keyId };
}

function buildAdditionalAuthenticatedData(
  context: CredentialEnvelopeContext,
  formatVersion: number,
  keyId: string,
) {
  return Buffer.from(
    JSON.stringify([
      "ink-memory.provider-credential-envelope",
      formatVersion,
      keyId,
      context.providerId,
      context.adapterKind,
      context.recordKind,
      context.recordId,
      context.revision,
    ]),
    "utf8",
  );
}

function decodeCanonicalBase64(
  value: string,
  field: string,
  expectedLength?: number,
) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_MALFORMED",
      `Credential envelope ${field} is malformed`,
    );
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_MALFORMED",
      `Credential envelope ${field} is malformed`,
    );
  }
  return decoded;
}

function parsePayload<T>(
  schema: CredentialEnvelopeSchema<T>,
  value: unknown,
): T {
  try {
    return schema.parse(value);
  } catch {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_PAYLOAD_INVALID",
      "Credential envelope payload is invalid",
    );
  }
}

export function encryptCredentialEnvelope<T>(
  payload: T,
  context: CredentialEnvelopeContext,
  schema: CredentialEnvelopeSchema<T>,
  material?: CredentialEnvelopeKey,
): EncryptedCredentialEnvelope {
  const checkedContext = assertContext(context);
  const checkedPayload = parsePayload(schema, payload);
  const { key, keyId } = resolveKey(material);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    buildAdditionalAuthenticatedData(
      checkedContext,
      CREDENTIAL_ENVELOPE_FORMAT_VERSION,
      keyId,
    ),
  );

  let plaintext: Buffer;
  try {
    plaintext = Buffer.from(JSON.stringify(checkedPayload), "utf8");
  } catch {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_PAYLOAD_INVALID",
      "Credential envelope payload is not JSON serializable",
    );
  }
  if (plaintext.length === 0) {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_PAYLOAD_INVALID",
      "Credential envelope payload is empty",
    );
  }

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    formatVersion: CREDENTIAL_ENVELOPE_FORMAT_VERSION,
    keyId,
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptCredentialEnvelope<T>(
  envelope: EncryptedCredentialEnvelope,
  context: CredentialEnvelopeContext,
  schema: CredentialEnvelopeSchema<T>,
  material?: CredentialEnvelopeKey,
): T {
  const checkedContext = assertContext(context);
  if (envelope.formatVersion !== CREDENTIAL_ENVELOPE_FORMAT_VERSION) {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_UNSUPPORTED_VERSION",
      "Credential envelope format version is not supported",
    );
  }

  const { key, keyId } = resolveKey(material);
  if (envelope.keyId !== keyId) {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_KEY_MISMATCH",
      "Credential envelope key is not available",
    );
  }

  const nonce = decodeCanonicalBase64(envelope.nonce, "nonce", 12);
  const tag = decodeCanonicalBase64(envelope.tag, "tag", 16);
  const ciphertext = decodeCanonicalBase64(
    envelope.ciphertext,
    "ciphertext",
  );

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      buildAdditionalAuthenticatedData(
        checkedContext,
        envelope.formatVersion,
        envelope.keyId,
      ),
    );
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_AUTHENTICATION_FAILED",
      "Credential envelope authentication failed",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new CredentialEnvelopeError(
      "CREDENTIAL_ENVELOPE_PAYLOAD_INVALID",
      "Credential envelope payload is invalid",
    );
  }
  return parsePayload(schema, decoded);
}
