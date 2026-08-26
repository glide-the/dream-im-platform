#!/usr/bin/env bash
# [Input] AutoDL Admin home, shared Dream data root, and service account identity.
# [Output] Idempotent Admin-owned PostgreSQL home/data and shared Artifact directory.
# [Pos] Root-only AutoDL Admin persistent-resource initializer; never moves database data.
# [Sync] 2026-08-26: separate PostgreSQL from the Dream resource root.
set -euo pipefail

ADMIN_HOME="${INK_AUTODL_ADMIN_HOME:-/var/lib/ink-memory}"
DREAM_DATA_ROOT="${INK_AUTODL_DATA_ROOT:-/root/autodl-tmp/ink-memory}"
SERVICE_USER="${INK_AUTODL_SERVICE_USER:-ink-memory}"
SERVICE_GROUP="${INK_AUTODL_SERVICE_GROUP:-$(id -gn "${SERVICE_USER}")}"
POSTGRES_DIR="${ADMIN_HOME}/data/postgres"
LEGACY_POSTGRES_DIR="${DREAM_DATA_ROOT}/postgres"
ARTIFACT_DIR="${DREAM_DATA_ROOT}/artifacts"

fail() { printf '[admin-data-init:error] %s\n' "$*" >&2; exit 1; }

for root_path in "${ADMIN_HOME}" "${DREAM_DATA_ROOT}"; do
  [[ "${root_path}" == /* && "${root_path}" != "/" ]] || fail "Persistent roots must be absolute non-root paths."
done
[[ "${ADMIN_HOME}" != "${DREAM_DATA_ROOT}" && "${ADMIN_HOME}" != "${DREAM_DATA_ROOT}/"* ]] || fail "Admin home must be outside the Dream data root."
id -u "${SERVICE_USER}" >/dev/null 2>&1 || fail "Admin service user does not exist: ${SERVICE_USER}"
for target in "${ADMIN_HOME}" "${ADMIN_HOME}/data" "${POSTGRES_DIR}" "${DREAM_DATA_ROOT}" "${ARTIFACT_DIR}"; do
  [[ ! -L "${target}" ]] || fail "Persistent directory must not be a symlink: ${target}"
done
if [[ -f "${LEGACY_POSTGRES_DIR}/PG_VERSION" && ! -f "${POSTGRES_DIR}/PG_VERSION" ]]; then
  fail "Legacy PostgreSQL data exists at ${LEGACY_POSTGRES_DIR}; refusing automatic migration or empty-cluster startup."
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${ADMIN_HOME}" "${ADMIN_HOME}/data"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0700 "${POSTGRES_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${DREAM_DATA_ROOT}" "${ARTIFACT_DIR}"

printf '[admin-data-init] PostgreSQL=%s Artifact=%s owner=%s:%s.\n' "${POSTGRES_DIR}" "${ARTIFACT_DIR}" "${SERVICE_USER}" "${SERVICE_GROUP}"
