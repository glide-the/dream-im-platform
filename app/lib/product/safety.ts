/**
 * Canonical Token-only Product API field-name firewall.
 *
 * Keep these entries in the same order as
 * `backend/services/admin_product/client.py` in ink-dream-memory.  The
 * fragments intentionally permit the explicit subscription-payment DTO
 * (`amountMicrousd`, `currency`, `paymentIntentId`). Cash balance, financial
 * ledger and secret/provider internals remain forbidden.
 */
export const PRODUCT_FORBIDDEN_KEY_FRAGMENTS = [
  "cash",
  "monetary",
  "financial",
  "topup",
  "ledger",
  "effectivefrom",
  "effectiveto",
  "provider",
  "secret",
  "credential",
  "platformuserid",
  "authorization",
  "apikey",
  "keyhash",
  "ciphertext",
] as const;

export function normalizedProductKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function productKeyIsForbidden(key: string) {
  const normalized = normalizedProductKey(key);
  return PRODUCT_FORBIDDEN_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}
