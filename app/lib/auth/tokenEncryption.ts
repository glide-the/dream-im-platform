// [Input] Admin-owned AEAD key and client/subject-bound token bundle.
// [Output] Ciphertext using the existing platform credential-encryption implementation.
// [Pos] Auth secret storage adapter; encrypted bundles never enter public DTOs/audit.
// [Sync] 2026-09-15: validate staged secret receipt configuration before any business write.
import { decryptCredential, encryptCredential } from "../security/credential-encryption";
import { AuthBoundaryError, requiredAuthValue } from "./config";

function authEncryptionKey() {
  const raw = requiredAuthValue("AUTH_TOKEN_ENCRYPTION_KEY");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new AuthBoundaryError("AUTH_ENCRYPTION_NOT_CONFIGURED");
  return key;
}
export function encryptAuthBundle(bundle: unknown) { return JSON.stringify(encryptCredential(JSON.stringify(bundle), authEncryptionKey())); }
export function assertAuthEncryptionConfigured() { authEncryptionKey(); }
export function decryptAuthBundle(ciphertext: string): unknown {
  try { return JSON.parse(decryptCredential(JSON.parse(ciphertext), authEncryptionKey())); }
  catch { throw new AuthBoundaryError("AUTH_BUNDLE_UNAVAILABLE"); }
}
