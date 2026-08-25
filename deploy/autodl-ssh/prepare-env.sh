#!/usr/bin/env bash
# [Input] Existing mode-0600 Admin env plus explicit AutoDL bind/public origins.
# [Output] Mode-0600 local AutoDL runtime env without printing secret values.
# [Pos] AutoDL Admin runtime configuration projector in deploy/autodl-ssh/.
# [Sync] 2026-08-26: introduce direct-host mappings and embedded-PG paths for AutoDL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_ENV_FILE="${AUTODL_SOURCE_ENV_FILE:-${REPO_ROOT}/.env.local}"
OUTPUT_ENV_FILE="${AUTODL_ENV_FILE:-${SCRIPT_DIR}/.env}"
AUTODL_DATA_ROOT="${AUTODL_DATA_ROOT:-/root/autodl-tmp/ink-memory}"
AUTODL_ADMIN_BIND_HOST="${AUTODL_ADMIN_BIND_HOST:-127.0.0.1}"
AUTODL_ADMIN_PORT="${AUTODL_ADMIN_PORT:-6008}"
AUTODL_ADMIN_PUBLIC_ORIGIN="${AUTODL_ADMIN_PUBLIC_ORIGIN:-}"
AUTODL_DREAM_PUBLIC_ORIGIN="${AUTODL_DREAM_PUBLIC_ORIGIN:-}"

err() { printf '[error] %s\n' "$*" >&2; exit 1; }

[[ -f "${SOURCE_ENV_FILE}" ]] || err "Missing source env: ${SOURCE_ENV_FILE}"
[[ "${AUTODL_DATA_ROOT}" == /root/* ]] || err "AUTODL_DATA_ROOT must stay under /root."
[[ "${AUTODL_ADMIN_BIND_HOST}" == "127.0.0.1" ]] || err "Admin must bind to 127.0.0.1 on AutoDL."
[[ "${AUTODL_ADMIN_PORT}" =~ ^[0-9]+$ ]] || err "AUTODL_ADMIN_PORT must be numeric."
[[ "${AUTODL_ADMIN_PUBLIC_ORIGIN}" =~ ^https://[^/]+(:[0-9]+)?$ ]] || err "AUTODL_ADMIN_PUBLIC_ORIGIN must be an exact HTTPS origin."
[[ "${AUTODL_DREAM_PUBLIC_ORIGIN}" =~ ^https://[^/]+(:[0-9]+)?$ ]] || err "AUTODL_DREAM_PUBLIC_ORIGIN must be an exact HTTPS origin."

temp_file="$(mktemp "${SCRIPT_DIR}/.env.XXXXXX")"
trap 'rm -f "${temp_file}"' EXIT
umask 077
awk -F= '
  BEGIN {
    split("DATABASE_URL MIGRATION_DATABASE_URL NODE_ENV PORT HOSTNAME BETTER_AUTH_URL RUN_DB_MIGRATIONS INK_DATABASE_MODE EMBEDDED_POSTGRES_DATA_DIR EMBEDDED_POSTGRES_PORT ARTIFACT_WORKSPACE_ROOT FILE_STORAGE_TYPE ADMIN_ORIGIN_ALLOWLIST PRODUCT_API_ORIGIN_ALLOWLIST", keys, " ")
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
  printf 'BETTER_AUTH_URL=%s\n' "${AUTODL_ADMIN_PUBLIC_ORIGIN}"
  printf 'RUN_DB_MIGRATIONS=false\n'
  printf 'INK_DATABASE_MODE=embedded-postgres\n'
  printf 'EMBEDDED_POSTGRES_DATA_DIR=%s/postgres\n' "${AUTODL_DATA_ROOT}"
  printf 'EMBEDDED_POSTGRES_PORT=54329\n'
  printf 'ARTIFACT_WORKSPACE_ROOT=%s/artifacts\n' "${AUTODL_DATA_ROOT}"
  printf 'FILE_STORAGE_TYPE=disabled\n'
  printf 'ADMIN_ORIGIN_ALLOWLIST=%s\n' "${AUTODL_ADMIN_PUBLIC_ORIGIN}"
  printf 'PRODUCT_API_ORIGIN_ALLOWLIST=%s\n' "${AUTODL_DREAM_PUBLIC_ORIGIN}"
} >>"${temp_file}"

for required_key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB ADMIN_SESSION_SECRET GATEWAY_API_KEY_PEPPER AI_CREDENTIAL_ENCRYPTION_KEY PRODUCT_API_JWT_SECRET; do
  grep -q "^${required_key}=" "${temp_file}" || err "${required_key} is missing from the source env."
done
password="$(awk -F= '$1 == "POSTGRES_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' "${temp_file}")"
[[ "${password}" =~ ^[A-Za-z0-9._~-]+$ ]] || err "POSTGRES_PASSWORD must be URL-safe for the direct-host DSN."

chmod 600 "${temp_file}"
mv "${temp_file}" "${OUTPUT_ENV_FILE}"
trap - EXIT
printf '[autodl-env] Wrote %s; secret values were not printed.\n' "${OUTPUT_ENV_FILE}"
