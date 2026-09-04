// [Input] Provider config values crossing Admin validation, response, or audit boundaries.
// [Output] Forbidden-key paths and recursively sanitized copies without mutating stored configuration.
// [Pos] Single Provider config secret firewall; Gateway/internal domain reads continue using raw database values.
// [Sync] 2026-09-04: reject new secret-like keys and redact compatible historical config at Admin exits.

export const PROVIDER_CONFIG_SECRET_KEY_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "authorization",
  "password",
  "cookie",
  "secret",
  "token",
  "credential",
] as const;

function normalizedConfigKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretLikeProviderConfigKey(key: string) {
  const normalized = normalizedConfigKey(key);
  return PROVIDER_CONFIG_SECRET_KEY_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix),
  );
}

export function findForbiddenProviderConfigKey(
  value: unknown,
  path: Array<string | number> = [],
): Array<string | number> | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findForbiddenProviderConfigKey(entry, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretLikeProviderConfigKey(key)) return [...path, key];
    const found = findForbiddenProviderConfigKey(entry, [...path, key]);
    if (found) return found;
  }
  return null;
}

function sanitizedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSecretLikeProviderConfigKey(key))
      .map(([key, entry]) => [key, sanitizedValue(entry)]),
  );
}

export function sanitizeProviderConfig(value: unknown): Record<string, unknown> {
  const sanitized = sanitizedValue(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

export function sanitizeProviderRecord<T extends Record<string, unknown>>(
  record: T,
): T {
  if (!("config" in record)) return record;
  return {
    ...record,
    config: sanitizeProviderConfig(record.config),
  };
}

export function sanitizeProviderAuditRecord<T extends Record<string, unknown>>(
  record: T,
): T {
  if (record.resource_type !== "providers") return record;
  const sanitizeSnapshot = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? sanitizeProviderRecord(value as Record<string, unknown>)
      : value;
  return {
    ...record,
    before: sanitizeSnapshot(record.before),
    after: sanitizeSnapshot(record.after),
  };
}
