#!/usr/bin/env bash
# [Input] Admin AutoDL env projector and persistent-directory initializer.
# [Output] Topology, idempotency, owner/mode, legacy-data, and symlink checks.
# [Pos] Provider-free AutoDL Admin deployment contract test.
# [Sync] 2026-08-26: cover /root/ink-autodl/data-style PostgreSQL topology and legacy guards.
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

cat >"${SOURCE_ENV}" <<'EOF'
POSTGRES_USER=ink_test
POSTGRES_PASSWORD=test-password
POSTGRES_DB=ink_test
ADMIN_SESSION_SECRET=test-admin-session
GATEWAY_API_KEY_PEPPER=test-gateway-pepper
AI_CREDENTIAL_ENCRYPTION_KEY=test-encryption-key
PRODUCT_API_JWT_SECRET=test-product-secret
EMBEDDED_POSTGRES_DATA_DIR=/tmp/stale-postgres
ARTIFACT_WORKSPACE_ROOT=/tmp/stale-artifacts
EOF

AUTODL_SOURCE_ENV_FILE="${SOURCE_ENV}" \
AUTODL_ENV_FILE="${OUTPUT_ENV}" \
AUTODL_DATA_ROOT="${PROJECTED_DATA_ROOT}" \
AUTODL_ADMIN_HOME="${ADMIN_HOME}" \
AUTODL_ADMIN_PUBLIC_ORIGIN=https://admin.example.test \
AUTODL_DREAM_PUBLIC_ORIGIN=https://dream.example.test \
  "${SCRIPT_DIR}/prepare-env.sh"

grep -Fx "EMBEDDED_POSTGRES_DATA_DIR=${ADMIN_HOME}/postgres" "${OUTPUT_ENV}"
grep -Fx "ARTIFACT_WORKSPACE_ROOT=${PROJECTED_DATA_ROOT}/artifacts" "${OUTPUT_ENV}"
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

mode_of() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
owner_of() { stat -f '%Su:%Sg' "$1" 2>/dev/null || stat -c '%U:%G' "$1"; }
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
