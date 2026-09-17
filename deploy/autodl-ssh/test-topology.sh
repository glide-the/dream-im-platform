#!/usr/bin/env bash
# [Input] Admin AutoDL env projector and persistent-directory initializer.
# [Output] Topology, idempotency, owner/mode, legacy-data, and symlink checks.
# [Pos] Provider-free AutoDL Admin deployment contract test.
# [Sync] 2026-09-17: assert examples keep AutoDL public origins deployment-injected.
# [Sync] 2026-09-17: assert generated service-client JSON survives the source-based remote launcher.
# [Sync] 2026-09-17: assert candidates are unique per attempt and contain a non-nested Drizzle journal.
# [Sync] 2026-09-16: read owner and mode through explicit Darwin/GNU stat branches.
# [Sync] 2026-09-16: assert the unified auth issuer/resource/service registration deployment projection.
# [Sync] 2026-09-04: assert AutoDL releases use the ordered Provider migration orchestrator.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/admin-autodl-topology.XXXXXX")"
trap 'rm -rf "${TEMP_ROOT}"' EXIT

SOURCE_ENV="${TEMP_ROOT}/admin-source.env"
OUTPUT_ENV="${TEMP_ROOT}/projected.env"
ADMIN_HOME="${TEMP_ROOT}/admin-home"
LEGACY_ADMIN_POSTGRES="${TEMP_ROOT}/legacy-admin-postgres"
DATA_ROOT="${TEMP_ROOT}/dream-data"
PROJECTED_DATA_ROOT="/root/autodl-tmp/ink-memory"
CURRENT_USER="$(id -un)"
CURRENT_GROUP="$(id -gn)"

if grep -Fq 'suoxya.com' "${SCRIPT_DIR}/platform.env.example"; then
  printf 'AutoDL example retained a product-domain public origin\n' >&2
  exit 1
fi
grep -Fq 'AUTODL_ADMIN_PUBLIC_ORIGIN=https://admin-tunnel.example.com:8443' "${SCRIPT_DIR}/platform.env.example"
grep -Fq 'AUTODL_DREAM_PUBLIC_ORIGIN=https://dream-tunnel.example.com:8443' "${SCRIPT_DIR}/platform.env.example"

grep -Fq 'cp scripts/migrate-provider-managed-accounts.mjs' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'smoke_candidate' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'migrate_admin candidate' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'activate_candidate' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'prune_old_releases' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'AUTODL_ADMIN_SMOKE_PORT' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'release_id="${release_commit}.$(date -u +%Y%m%d%H%M%S)"' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'rm -rf \"\${staging}/drizzle\"' "${SCRIPT_DIR}/deploy.sh"
grep -Fq 'test -f \"\${staging}/drizzle/meta/_journal.json\"' "${SCRIPT_DIR}/deploy.sh"
if grep -Fq 'maintenance migrate.js' "${SCRIPT_DIR}/deploy.sh"; then
  printf 'AutoDL deployment bypassed the Provider migration orchestrator\n' >&2
  exit 1
fi

cat >"${SOURCE_ENV}" <<'EOF'
POSTGRES_USER=ink_test
POSTGRES_PASSWORD=test-password
POSTGRES_DB=ink_test
ADMIN_SESSION_SECRET=test-admin-session
ADMIN_BOOTSTRAP_TOKEN=test-admin-bootstrap
GATEWAY_API_KEY_PEPPER=test-gateway-pepper
AI_CREDENTIAL_ENCRYPTION_KEY=test-encryption-key
PRODUCT_API_JWT_SECRET=test-product-secret
BETTER_AUTH_SECRET=better-auth-secret-at-least-thirty-two-bytes
AUTH_DATABASE_URL=postgres://ink_auth:test@127.0.0.1:54329/ink-memory
ADMIN_CONTROL_DATABASE_URL=postgres://ink_admin_control:test@127.0.0.1:54329/ink-memory
DREAM_DATA_DATABASE_URL=postgres://ink_dream_data:test@127.0.0.1:54329/ink-memory
GOOGLE_CLIENT_ID=test-google-client
GOOGLE_CLIENT_SECRET=test-google-secret
AUTH_TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
AUTH_DEVICE_CLIENT_ID=ink-dream-device
DREAM_GATEWAY_CLIENT_BINDINGS=[{"service_client_id":"ink-dream-service","gateway_client_id":"test-gateway","oauth_client_ids":["ink-dream-browser"]}]
INK_WORKFLOW_TOKEN_SECRET=workflow-secret-at-least-thirty-two-bytes
DREAM_WORKSPACE_PLUGIN_POLICY_JSON={"version":1}
DREAM_RUNTIME_ACTIVATION_POLICY_JSON={"version":1}
DREAM_DECK_POLICY_JSON={"version":1}
EMBEDDED_POSTGRES_DATA_DIR=/tmp/stale-postgres
ARTIFACT_WORKSPACE_ROOT=/tmp/stale-artifacts
EOF

SERVICE_CLIENTS='[{"id":"ink-dream-service","secret":"dream-service-secret-at-least-thirty-two-bytes","origin":"https://dream.example.test","oauthClientId":"ink-dream-browser","redirectUri":"https://dream.example.test/auth/callback","backgroundScopes":["capabilities:read"]}]'

AUTODL_SOURCE_ENV_FILE="${SOURCE_ENV}" \
AUTODL_ENV_FILE="${OUTPUT_ENV}" \
AUTODL_DATA_ROOT="${PROJECTED_DATA_ROOT}" \
AUTODL_ADMIN_HOME="${ADMIN_HOME}" \
AUTODL_ADMIN_PUBLIC_ORIGIN=https://admin.example.test \
AUTODL_DREAM_PUBLIC_ORIGIN=https://dream.example.test \
AUTODL_DREAM_DATA_SERVICE_CLIENTS="${SERVICE_CLIENTS}" \
  "${SCRIPT_DIR}/prepare-env.sh"

grep -Fx "EMBEDDED_POSTGRES_DATA_DIR=${ADMIN_HOME}/postgres" "${OUTPUT_ENV}"
grep -Fx "ARTIFACT_WORKSPACE_ROOT=${PROJECTED_DATA_ROOT}/artifacts" "${OUTPUT_ENV}"
grep -Fx "BETTER_AUTH_URL=https://admin.example.test/api/auth" "${OUTPUT_ENV}"
grep -Fx "AUTH_TRUSTED_ORIGINS=https://admin.example.test,https://dream.example.test" "${OUTPUT_ENV}"
grep -Fx "DREAM_API_RESOURCE=https://dream.example.test/api" "${OUTPUT_ENV}"
# The direct-host launcher sources this file; validate the resulting value rather than its shell encoding.
set -a
# shellcheck disable=SC1090 -- generated fixture is the contract under test.
source "${OUTPUT_ENV}"
set +a
[[ "${DREAM_DATA_SERVICE_CLIENTS}" == "${SERVICE_CLIENTS}" ]]
grep -Fx "DREAM_REFLECTIONS_WORKSPACE_ROOT=${PROJECTED_DATA_ROOT}/artifacts/reflections" "${OUTPUT_ENV}"
if grep -Fq "EMBEDDED_POSTGRES_DATA_DIR=${PROJECTED_DATA_ROOT}" "${OUTPUT_ENV}"; then
  printf 'PostgreSQL was projected into the Dream data root\n' >&2
  exit 1
fi

for _ in 1 2; do
  INK_AUTODL_ADMIN_HOME="${ADMIN_HOME}" \
  INK_AUTODL_DATA_ROOT="${DATA_ROOT}" \
  INK_AUTODL_SERVICE_USER="${CURRENT_USER}" \
  INK_AUTODL_SERVICE_GROUP="${CURRENT_GROUP}" \
  INK_AUTODL_LEGACY_ADMIN_POSTGRES_DIR="${LEGACY_ADMIN_POSTGRES}" \
    "${SCRIPT_DIR}/runtime/init-admin-data.sh"
done

mode_of() {
  case "$(uname -s)" in
    Darwin) stat -f '%Lp' "$1" ;;
    *) stat -c '%a' "$1" ;;
  esac
}
owner_of() {
  case "$(uname -s)" in
    Darwin) stat -f '%Su:%Sg' "$1" ;;
    *) stat -c '%U:%G' "$1" ;;
  esac
}
[[ "$(mode_of "${ADMIN_HOME}/postgres")" == "700" ]]
[[ "$(owner_of "${ADMIN_HOME}/postgres")" == "${CURRENT_USER}:${CURRENT_GROUP}" ]]
[[ "$(mode_of "${DATA_ROOT}/artifacts")" == "750" ]]

rm -rf "${ADMIN_HOME}/postgres"
mkdir -p "${DATA_ROOT}/postgres"
printf '18\n' >"${DATA_ROOT}/postgres/PG_VERSION"
if INK_AUTODL_ADMIN_HOME="${ADMIN_HOME}" \
  INK_AUTODL_DATA_ROOT="${DATA_ROOT}" \
  INK_AUTODL_SERVICE_USER="${CURRENT_USER}" \
  INK_AUTODL_SERVICE_GROUP="${CURRENT_GROUP}" \
  INK_AUTODL_LEGACY_ADMIN_POSTGRES_DIR="${LEGACY_ADMIN_POSTGRES}" \
  "${SCRIPT_DIR}/runtime/init-admin-data.sh" >/dev/null 2>&1; then
  printf 'legacy PostgreSQL data was silently abandoned\n' >&2
  exit 1
fi

rm -rf "${DATA_ROOT}/postgres"
mkdir -p "${LEGACY_ADMIN_POSTGRES}"
printf '18\n' >"${LEGACY_ADMIN_POSTGRES}/PG_VERSION"
if INK_AUTODL_ADMIN_HOME="${ADMIN_HOME}" \
  INK_AUTODL_DATA_ROOT="${DATA_ROOT}" \
  INK_AUTODL_SERVICE_USER="${CURRENT_USER}" \
  INK_AUTODL_SERVICE_GROUP="${CURRENT_GROUP}" \
  INK_AUTODL_LEGACY_ADMIN_POSTGRES_DIR="${LEGACY_ADMIN_POSTGRES}" \
  "${SCRIPT_DIR}/runtime/init-admin-data.sh" >/dev/null 2>&1; then
  printf 'previous Admin PostgreSQL data was silently abandoned\n' >&2
  exit 1
fi

rm -rf "${LEGACY_ADMIN_POSTGRES}"
mkdir -p "${ADMIN_HOME}/postgres"
mv "${DATA_ROOT}/artifacts" "${DATA_ROOT}/artifacts.real"
ln -s "${DATA_ROOT}/artifacts.real" "${DATA_ROOT}/artifacts"
if INK_AUTODL_ADMIN_HOME="${ADMIN_HOME}" \
  INK_AUTODL_DATA_ROOT="${DATA_ROOT}" \
  INK_AUTODL_SERVICE_USER="${CURRENT_USER}" \
  INK_AUTODL_SERVICE_GROUP="${CURRENT_GROUP}" \
  INK_AUTODL_LEGACY_ADMIN_POSTGRES_DIR="${LEGACY_ADMIN_POSTGRES}" \
  "${SCRIPT_DIR}/runtime/init-admin-data.sh" >/dev/null 2>&1; then
  printf 'symlinked Artifact directory was accepted\n' >&2
  exit 1
fi

printf '[admin-autodl-test] topology contract passed.\n'
