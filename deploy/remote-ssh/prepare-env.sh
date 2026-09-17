#!/usr/bin/env bash
# [Input] docker/.env plus Admin and Dream public origins.
# [Output] Mode-0600 env for Admin with embedded PostgreSQL and disabled storage.
# [Pos] Alibaba Cloud Admin runtime config generator in deploy/remote-ssh/.
# [Sync] 2026-09-16: project exact unified-auth origins and a deployment-owned Dream service registration.
# [Sync] 2026-08-21: preserve secrets, disable MinIO, and cap low-memory ECS builds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_ENV="${ADMIN_ENV_SOURCE:-${REPO_ROOT}/docker/.env}"
OUTPUT_ENV="${ADMIN_REMOTE_ENV_FILE:-${SCRIPT_DIR}/.env}"
ADMIN_PUBLIC_ORIGIN="${ADMIN_PUBLIC_ORIGIN:-}"
DREAM_PUBLIC_ORIGIN="${DREAM_PUBLIC_ORIGIN:-}"
REMOTE_ADMIN_PORT="${REMOTE_ADMIN_PORT:-3100}"
REMOTE_PLATFORM_NETWORK="${REMOTE_PLATFORM_NETWORK:-ink-memory-platform}"
REMOTE_DREAM_DATA_SERVICE_CLIENTS="${REMOTE_DREAM_DATA_SERVICE_CLIENTS:-}"

err() { printf '[error] %s\n' "$*" >&2; exit 1; }

[[ -f "${SOURCE_ENV}" ]] || err "Missing source env: ${SOURCE_ENV}"
[[ "${ADMIN_PUBLIC_ORIGIN}" =~ ^https://[^/]+(:[0-9]+)?$ ]] || err "ADMIN_PUBLIC_ORIGIN must be an exact HTTPS origin."
[[ "${DREAM_PUBLIC_ORIGIN}" =~ ^https://[^/]+(:[0-9]+)?$ ]] || err "DREAM_PUBLIC_ORIGIN must be an exact HTTPS origin."
[[ "${REMOTE_ADMIN_PORT}" =~ ^[0-9]+$ ]] || err "REMOTE_ADMIN_PORT must be numeric."
[[ -n "${REMOTE_DREAM_DATA_SERVICE_CLIENTS}" && "${REMOTE_DREAM_DATA_SERVICE_CLIENTS}" != *$'\n'* ]] || err "REMOTE_DREAM_DATA_SERVICE_CLIENTS must be one-line JSON."
admin_domain="${ADMIN_PUBLIC_ORIGIN#https://}"
admin_domain="${admin_domain%%/*}"
[[ "${admin_domain}" =~ ^[A-Za-z0-9.-]+$ ]] || err "ADMIN_PUBLIC_ORIGIN must contain a plain DNS hostname."

REMOTE_DREAM_DATA_SERVICE_CLIENTS="${REMOTE_DREAM_DATA_SERVICE_CLIENTS}" DREAM_PUBLIC_ORIGIN="${DREAM_PUBLIC_ORIGIN}" node --input-type=module -e '
const clients = JSON.parse(process.env.REMOTE_DREAM_DATA_SERVICE_CLIENTS);
const origin = process.env.DREAM_PUBLIC_ORIGIN;
const valid = Array.isArray(clients) && clients.length > 0
  && new Set(clients.map(client => client?.id)).size === clients.length
  && clients.every(client => client && typeof client.id === "string" && client.id
    && typeof client.oauthClientId === "string" && client.oauthClientId
    && Array.isArray(client.backgroundScopes)
    && client.backgroundScopes.every(scope => typeof scope === "string" && scope)
    && client.origin === origin && client.redirectUri === `${origin}/auth/callback`
    && typeof client.secret === "string" && Buffer.byteLength(client.secret) >= 32);
if (!valid) process.exit(1);
' || err "REMOTE_DREAM_DATA_SERVICE_CLIENTS must bind every registered client to the exact Dream origin/callback."

for required_key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB ADMIN_SESSION_SECRET \
  ADMIN_BOOTSTRAP_TOKEN GATEWAY_API_KEY_PEPPER AI_CREDENTIAL_ENCRYPTION_KEY \
  PRODUCT_API_JWT_SECRET BETTER_AUTH_SECRET AUTH_DATABASE_URL ADMIN_CONTROL_DATABASE_URL \
  DREAM_DATA_DATABASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET AUTH_TOKEN_ENCRYPTION_KEY \
  AUTH_DEVICE_CLIENT_ID DREAM_GATEWAY_CLIENT_BINDINGS INK_WORKFLOW_TOKEN_SECRET \
  DREAM_WORKSPACE_PLUGIN_POLICY_JSON DREAM_RUNTIME_ACTIVATION_POLICY_JSON DREAM_DECK_POLICY_JSON; do
  grep -Eq "^${required_key}=.+$" "${SOURCE_ENV}" || err "${required_key} is missing or empty in ${SOURCE_ENV}."
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
  $1 == "BETTER_AUTH_URL" ||
  $1 == "AUTH_TRUSTED_ORIGINS" ||
  $1 == "DREAM_API_RESOURCE" ||
  $1 == "DREAM_DATA_SERVICE_CLIENTS" ||
  $1 == "DREAM_REFLECTIONS_WORKSPACE_ROOT" ||
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
  printf 'DEBIAN_MIRROR=http://mirrors.cloud.aliyuncs.com/debian\n'
  printf 'DEBIAN_SECURITY_MIRROR=http://mirrors.cloud.aliyuncs.com/debian-security\n'
  printf 'PGDG_MIRROR=http://mirrors.cloud.aliyuncs.com/postgresql/repos/apt\n'
  printf 'NEXT_BUILD_CPUS=1\n'
  printf 'NEXT_BUILD_MAX_OLD_SPACE_MB=640\n'
  printf 'EMBEDDED_POSTGRES_SHARED_BUFFERS=96MB\n'
  printf 'EMBEDDED_POSTGRES_MAX_CONNECTIONS=50\n'
  printf 'ADMIN_ORIGIN_ALLOWLIST=%s\n' "${ADMIN_PUBLIC_ORIGIN}"
  printf 'BETTER_AUTH_URL=%s/api/auth\n' "${ADMIN_PUBLIC_ORIGIN}"
  printf 'AUTH_TRUSTED_ORIGINS=%s,%s\n' "${ADMIN_PUBLIC_ORIGIN}" "${DREAM_PUBLIC_ORIGIN}"
  printf 'DREAM_API_RESOURCE=%s/api\n' "${DREAM_PUBLIC_ORIGIN}"
  printf 'DREAM_DATA_SERVICE_CLIENTS=%s\n' "${REMOTE_DREAM_DATA_SERVICE_CLIENTS}"
  printf 'DREAM_REFLECTIONS_WORKSPACE_ROOT=/artifacts/reflections\n'
  printf 'PRODUCT_API_ORIGIN_ALLOWLIST=%s\n' "${DREAM_PUBLIC_ORIGIN}"
  printf 'FILE_STORAGE_TYPE=disabled\n'
  printf 'ARTIFACT_WORKSPACE_ROOT=/artifacts\n'
  printf 'RUN_DB_MIGRATIONS=false\n'
} >>"${temp_file}"
chmod 600 "${temp_file}"
mv "${temp_file}" "${OUTPUT_ENV}"
trap - EXIT
printf '[remote-env] Wrote %s with mode 0600; secret values were not printed.\n' "${OUTPUT_ENV}"
