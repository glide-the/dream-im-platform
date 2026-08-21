#!/usr/bin/env bash
# [Input] docker/.env plus Admin and Dream public origins.
# [Output] Mode-0600 env for Admin with embedded PostgreSQL and disabled storage.
# [Pos] Alibaba Cloud Admin runtime config generator in deploy/remote-ssh/.
# [Sync] 2026-08-21: preserve database/auth secrets while removing MinIO and
#                    selecting the embedded PostgreSQL topology explicitly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_ENV="${ADMIN_ENV_SOURCE:-${REPO_ROOT}/docker/.env}"
OUTPUT_ENV="${ADMIN_REMOTE_ENV_FILE:-${SCRIPT_DIR}/.env}"
ADMIN_PUBLIC_ORIGIN="${ADMIN_PUBLIC_ORIGIN:-}"
DREAM_PUBLIC_ORIGIN="${DREAM_PUBLIC_ORIGIN:-}"
REMOTE_ADMIN_PORT="${REMOTE_ADMIN_PORT:-3100}"
REMOTE_PLATFORM_NETWORK="${REMOTE_PLATFORM_NETWORK:-ink-memory-platform}"

err() { printf '[error] %s\n' "$*" >&2; exit 1; }

[[ -f "${SOURCE_ENV}" ]] || err "Missing source env: ${SOURCE_ENV}"
[[ "${ADMIN_PUBLIC_ORIGIN}" == https://* ]] || err "ADMIN_PUBLIC_ORIGIN must use https://"
[[ "${DREAM_PUBLIC_ORIGIN}" == https://* ]] || err "DREAM_PUBLIC_ORIGIN must use https://"
admin_domain="${ADMIN_PUBLIC_ORIGIN#https://}"
admin_domain="${admin_domain%%/*}"
[[ "${admin_domain}" =~ ^[A-Za-z0-9.-]+$ ]] || err "ADMIN_PUBLIC_ORIGIN must contain a plain DNS hostname."

for required_key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB ADMIN_SESSION_SECRET \
  ADMIN_BOOTSTRAP_TOKEN GATEWAY_API_KEY_PEPPER AI_CREDENTIAL_ENCRYPTION_KEY \
  PRODUCT_API_JWT_SECRET; do
  grep -q "^${required_key}=" "${SOURCE_ENV}" || err "${required_key} is missing from ${SOURCE_ENV}."
done

temp_file="$(mktemp "${SCRIPT_DIR}/.env.XXXXXX")"
trap 'rm -f "${temp_file}"' EXIT
umask 077
awk -F= '
  $1 == "APP_PORT" ||
  $1 == "POSTGRES_PORT" ||
  $1 ~ /^MINIO_/ ||
  $1 ~ /^FILE_STORAGE_/ ||
  $1 ~ /^AWS_/ ||
  $1 == "BLOB_READ_WRITE_TOKEN" ||
  $1 ~ /^EMBEDDED_POSTGRES_/ ||
  $1 == "ADMIN_ORIGIN_ALLOWLIST" ||
  $1 == "PRODUCT_API_ORIGIN_ALLOWLIST" ||
  $1 == "RUN_DB_MIGRATIONS" { next }
  { print }
' "${SOURCE_ENV}" >"${temp_file}"
{
  printf '\n# Alibaba Cloud topology; generated, do not commit.\n'
  printf 'REMOTE_PLATFORM_NETWORK=%s\n' "${REMOTE_PLATFORM_NETWORK}"
  printf 'REMOTE_ADMIN_BIND_HOST=127.0.0.1\n'
  printf 'REMOTE_ADMIN_PORT=%s\n' "${REMOTE_ADMIN_PORT}"
  printf 'REMOTE_ADMIN_DOMAIN=%s\n' "${admin_domain}"
  printf 'NEXT_BUILD_CPUS=1\n'
  printf 'NEXT_BUILD_MAX_OLD_SPACE_MB=1024\n'
  printf 'EMBEDDED_POSTGRES_SHARED_BUFFERS=96MB\n'
  printf 'EMBEDDED_POSTGRES_MAX_CONNECTIONS=50\n'
  printf 'ADMIN_ORIGIN_ALLOWLIST=%s\n' "${ADMIN_PUBLIC_ORIGIN}"
  printf 'PRODUCT_API_ORIGIN_ALLOWLIST=%s\n' "${DREAM_PUBLIC_ORIGIN}"
  printf 'FILE_STORAGE_TYPE=disabled\n'
  printf 'ARTIFACT_WORKSPACE_ROOT=/artifacts\n'
  printf 'RUN_DB_MIGRATIONS=false\n'
} >>"${temp_file}"
chmod 600 "${temp_file}"
mv "${temp_file}" "${OUTPUT_ENV}"
trap - EXIT
printf '[remote-env] Wrote %s with mode 0600; secret values were not printed.\n' "${OUTPUT_ENV}"
