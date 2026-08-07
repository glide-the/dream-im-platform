import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  tag: string;
  fingerprint: string;
};

export class CredentialConfigurationError extends Error {
  readonly code = "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "CredentialConfigurationError";
  }
}

function parseKey(raw: string) {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32 && decoded.toString("base64") === trimmed) {
    return decoded;
  }
  throw new CredentialConfigurationError(
    "AI_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or canonical base64",
  );
}

export function getCredentialEncryptionKey() {
  const raw = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new CredentialConfigurationError(
      "AI_CREDENTIAL_ENCRYPTION_KEY is required before provider credentials can be stored or used",
    );
  }
  return parseKey(raw);
}

export function credentialFingerprint(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function encryptCredential(
  plaintext: string,
  key = getCredentialEncryptionKey(),
): EncryptedCredential {
  if (!plaintext) throw new RangeError("Credential must not be empty");
  if (key.length !== 32) {
    throw new CredentialConfigurationError("Credential key must be 32 bytes");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    fingerprint: credentialFingerprint(plaintext),
  };
}

export function decryptCredential(
  encrypted: Pick<EncryptedCredential, "ciphertext" | "iv" | "tag">,
  key = getCredentialEncryptionKey(),
) {
  if (key.length !== 32) {
    throw new CredentialConfigurationError("Credential key must be 32 bytes");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
