import { describe, expect, it } from "vitest";
import {
  CredentialConfigurationError,
  credentialFingerprint,
  decryptCredential,
  encryptCredential,
  getCredentialEncryptionKey,
} from "./credential-encryption";

describe("provider credential encryption", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips with AES-256-GCM without exposing plaintext", () => {
    const encrypted = encryptCredential("sk-sensitive", key);
    expect(encrypted.ciphertext).not.toContain("sk-sensitive");
    expect(encrypted.fingerprint).toBe(
      credentialFingerprint("sk-sensitive"),
    );
    expect(decryptCredential(encrypted, key)).toBe("sk-sensitive");
  });

  it("rejects tampering", () => {
    const encrypted = encryptCredential("sk-sensitive", key);
    expect(() =>
      decryptCredential(
        { ...encrypted, tag: Buffer.alloc(16).toString("base64") },
        key,
      ),
    ).toThrow();
  });

  it("requires an explicit production-quality key", () => {
    const previous = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    try {
      expect(() => getCredentialEncryptionKey()).toThrow(
        CredentialConfigurationError,
      );
    } finally {
      if (previous === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = previous;
    }
  });
});
