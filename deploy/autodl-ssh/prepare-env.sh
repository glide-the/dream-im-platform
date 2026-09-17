#!/usr/bin/env bash
# [Input] Existing mode-0600 Admin env plus explicit AutoDL bind/public origins.
# [Output] Mode-0600 local AutoDL runtime env without printing secret values.
# [Pos] AutoDL Admin runtime configuration projector in deploy/autodl-ssh/.
# [Sync] 2026-09-17: shell-escape the generated service-client JSON consumed by source-based launchers.
# [Sync] 2026-09-16: project the complete unified auth/data contract with deployment-owned service registration.
# [Sync] 2026-08-26: project PostgreSQL into /root/ink-autodl/data/postgres.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
AUTODL_PLATFORM_ENV_FILE="${AUTODL_PLATFORM_ENV_FILE:-${SCRIPT_DIR}/platform.env}"
if [[ -f "${AUTODL_PLATFORM_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090 -- the operator explicitly selects this local platform file.
  source "${AUTODL_PLATFORM_ENV_FILE}"
fi
SOURCE_ENV_FILE="${AUTODL_SOURCE_ENV_FILE:-${REPO_ROOT}/.env.local}"
OUTPUT_ENV_FILE="${AUTODL_ENV_FILE:-${SCRIPT_DIR}/.env}"
AUTODL_DATA_ROOT="${AUTODL_DATA_ROOT:-/root/autodl-tmp/ink-memory}"
AUTODL_ADMIN_HOME="${AUTODL_ADMIN_HOME:-/root/ink-autodl/data}"
AUTODL_ADMIN_BIND_HOST="${AUTODL_ADMIN_BIND_HOST:-127.0.0.1}"
AUTODL_ADMIN_PORT="${AUTODL_ADMIN_PORT:-6008}"
AUTODL_ADMIN_PUBLIC_ORIGIN="${AUTODL_ADMIN_PUBLIC_ORIGIN:-}"
AUTODL_DREAM_PUBLIC_ORIGIN="${AUTODL_DREAM_PUBLIC_ORIGIN:-}"
AUTODL_DREAM_DATA_SERVICE_CLIENTS="${AUTODL_DREAM_DATA_SERVICE_CLIENTS:-}"

err() { printf '[error] %s\n' "$*" >&2; exit 1; }

[[ -f "${SOURCE_ENV_FILE}" ]] || err "Missing source env: ${SOURCE_ENV_FILE}"
[[ "${AUTODL_DATA_ROOT}" == /root/* ]] || err "AUTODL_DATA_ROOT must stay under /root."
[[ "${AUTODL_ADMIN_HOME}" == /* && "${AUTODL_ADMIN_HOME}" != "${AUTODL_DATA_ROOT}" && "${AUTODL_ADMIN_HOME}" != "${AUTODL_DATA_ROOT}/"* ]] || err "AUTODL_ADMIN_HOME must be absolute and outside AUTODL_DATA_ROOT."
[[ "${AUTODL_ADMIN_BIND_HOST}" == "127.0.0.1" ]] || err "Admin must bind to 127.0.0.1 on AutoDL."
[[ "${AUTODL_ADMIN_PORT}" =~ ^[0-9]+$ ]] || err "AUTODL_ADMIN_PORT must be numeric."
[[ "${AUTODL_ADMIN_PUBLIC_ORIGIN}" =~ ^https://[^/]+(:[0-9]+)?$ ]] || err "AUTODL_ADMIN_PUBLIC_ORIGIN must be an exact HTTPS origin."
[[ "${AUTODL_DREAM_PUBLIC_ORIGIN}" =~ ^https://[^/]+(:[0-9]+)?$ ]] || err "AUTODL_DREAM_PUBLIC_ORIGIN must be an exact HTTPS origin."
[[ -n "${AUTODL_DREAM_DATA_SERVICE_CLIENTS}" && "${AUTODL_DREAM_DATA_SERVICE_CLIENTS}" != *$'\n'* ]] || err "AUTODL_DREAM_DATA_SERVICE_CLIENTS must be one-line JSON."

AUTODL_DREAM_DATA_SERVICE_CLIENTS="${AUTODL_DREAM_DATA_SERVICE_CLIENTS}" AUTODL_DREAM_PUBLIC_ORIGIN="${AUTODL_DREAM_PUBLIC_ORIGIN}" node --input-type=module -e '
const clients = JSON.parse(process.env.AUTODL_DREAM_DATA_SERVICE_CLIENTS);
const origin = process.env.AUTODL_DREAM_PUBLIC_ORIGIN;
const valid = Array.isArray(clients) && clients.length > 0
  && new Set(clients.map(client => client?.id)).size === clients.length
  && clients.every(client => client && typeof client.id === "string" && client.id
    && typeof client.oauthClientId === "string" && client.oauthClientId
    && Array.isArray(client.backgroundScopes)
    && client.backgroundScopes.every(scope => typeof scope === "string" && scope)
    && client.origin === origin && client.redirectUri === `${origin}/auth/callback`
    && typeof client.secret === "string" && Buffer.byteLength(client.secret) >= 32);
if (!valid) process.exit(1);
' || err "AUTODL_DREAM_DATA_SERVICE_CLIENTS must bind every registered client to the exact Dream origin/callback."

for required_key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB ADMIN_SESSION_SECRET \
  ADMIN_BOOTSTRAP_TOKEN GATEWAY_API_KEY_PEPPER AI_CREDENTIAL_ENCRYPTION_KEY \
  PRODUCT_API_JWT_SECRET BETTER_AUTH_SECRET AUTH_DATABASE_URL ADMIN_CONTROL_DATABASE_URL \
  DREAM_DATA_DATABASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET AUTH_TOKEN_ENCRYPTION_KEY \
  AUTH_DEVICE_CLIENT_ID DREAM_GATEWAY_CLIENT_BINDINGS INK_WORKFLOW_TOKEN_SECRET \
  DREAM_WORKSPACE_PLUGIN_POLICY_JSON DREAM_RUNTIME_ACTIVATION_POLICY_JSON DREAM_DECK_POLICY_JSON; do
  grep -Eq "^${required_key}=.+$" "${SOURCE_ENV_FILE}" || err "${required_key} is missing or empty in ${SOURCE_ENV_FILE}."
done

temp_file="$(mktemp "${SCRIPT_DIR}/.env.XXXXXX")"
trap 'rm -f "${temp_file}"' EXIT
umask 077
awk -F= '
  BEGIN {
    split("DATABASE_URL MIGRATION_DATABASE_URL NODE_ENV PORT HOSTNAME BETTER_AUTH_URL AUTH_TRUSTED_ORIGINS DREAM_API_RESOURCE DREAM_DATA_SERVICE_CLIENTS DREAM_REFLECTIONS_WORKSPACE_ROOT RUN_DB_MIGRATIONS INK_DATABASE_MODE EMBEDDED_POSTGRES_DATA_DIR EMBEDDED_POSTGRES_PORT ARTIFACT_WORKSPACE_ROOT FILE_STORAGE_TYPE ADMIN_ORIGIN_ALLOWLIST PRODUCT_API_ORIGIN_ALLOWLIST", keys, " ")
    for (i in keys) excluded[keys[i]] = 1
  }
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    key=$1
    if (!excluded[key]) print
  }
' "${SOURCE_ENV_FILE}" >"${temp_file}"
{
  printf 'NODE_ENV=production\n'
  printf 'PORT=%s\n' "${AUTODL_ADMIN_PORT}"
  printf 'HOSTNAME=%s\n' "${AUTODL_ADMIN_BIND_HOST}"
  printf 'BETTER_AUTH_URL=%s/api/auth\n' "${AUTODL_ADMIN_PUBLIC_ORIGIN}"
  printf 'AUTH_TRUSTED_ORIGINS=%s,%s\n' "${AUTODL_ADMIN_PUBLIC_ORIGIN}" "${AUTODL_DREAM_PUBLIC_ORIGIN}"
  printf 'DREAM_API_RESOURCE=%s/api\n' "${AUTODL_DREAM_PUBLIC_ORIGIN}"
  printf 'DREAM_DATA_SERVICE_CLIENTS=%q\n' "${AUTODL_DREAM_DATA_SERVICE_CLIENTS}"
  printf 'DREAM_REFLECTIONS_WORKSPACE_ROOT=%s/artifacts/reflections\n' "${AUTODL_DATA_ROOT}"
  printf 'RUN_DB_MIGRATIONS=false\n'
  printf 'INK_DATABASE_MODE=embedded-postgres\n'
  printf 'EMBEDDED_POSTGRES_DATA_DIR=%s/postgres\n' "${AUTODL_ADMIN_HOME}"
  printf 'EMBEDDED_POSTGRES_PORT=54329\n'
  printf 'ARTIFACT_WORKSPACE_ROOT=%s/artifacts\n' "${AUTODL_DATA_ROOT}"
  printf 'FILE_STORAGE_TYPE=disabled\n'
  printf 'ADMIN_ORIGIN_ALLOWLIST=%s\n' "${AUTODL_ADMIN_PUBLIC_ORIGIN}"
  printf 'PRODUCT_API_ORIGIN_ALLOWLIST=%s\n' "${AUTODL_DREAM_PUBLIC_ORIGIN}"
} >>"${temp_file}"

password="$(awk -F= '$1 == "POSTGRES_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' "${temp_file}")"
[[ "${password}" =~ ^[A-Za-z0-9._~-]+$ ]] || err "POSTGRES_PASSWORD must be URL-safe for the direct-host DSN."

chmod 600 "${temp_file}"
mv "${temp_file}" "${OUTPUT_ENV_FILE}"
trap - EXIT
printf '[autodl-env] Wrote %s; secret values were not printed.\n' "${OUTPUT_ENV_FILE}"
