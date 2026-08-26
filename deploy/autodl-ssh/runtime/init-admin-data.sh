#!/usr/bin/env bash
# [Input] AutoDL Admin home, shared Dream data root, and service account identity.
# [Output] Idempotent Admin-owned PostgreSQL data root and shared Artifact directory.
# [Pos] Root-only AutoDL Admin persistent-resource initializer; never moves database data.
# [Sync] 2026-08-26: place PostgreSQL at /root/ink-autodl/data/postgres with legacy guards.
set -euo pipefail

ADMIN_HOME="${INK_AUTODL_ADMIN_HOME:-/root/ink-autodl/data}"
DREAM_DATA_ROOT="${INK_AUTODL_DATA_ROOT:-/root/autodl-tmp/ink-memory}"
SERVICE_USER="${INK_AUTODL_SERVICE_USER:-ink-memory}"
SERVICE_GROUP="${INK_AUTODL_SERVICE_GROUP:-$(id -gn "${SERVICE_USER}")}"
POSTGRES_DIR="${ADMIN_HOME}/postgres"
LEGACY_DREAM_POSTGRES_DIR="${DREAM_DATA_ROOT}/postgres"
LEGACY_ADMIN_POSTGRES_DIR="${INK_AUTODL_LEGACY_ADMIN_POSTGRES_DIR:-/var/lib/ink-memory/data/postgres}"
ARTIFACT_DIR="${DREAM_DATA_ROOT}/artifacts"

fail() { printf '[admin-data-init:error] %s\n' "$*" >&2; exit 1; }

for root_path in "${ADMIN_HOME}" "${DREAM_DATA_ROOT}"; do
  [[ "${root_path}" == /* && "${root_path}" != "/" ]] || fail "Persistent roots must be absolute non-root paths."
done
[[ "${ADMIN_HOME}" != "${DREAM_DATA_ROOT}" && "${ADMIN_HOME}" != "${DREAM_DATA_ROOT}/"* ]] || fail "Admin home must be outside the Dream data root."
id -u "${SERVICE_USER}" >/dev/null 2>&1 || fail "Admin service user does not exist: ${SERVICE_USER}"
for target in "${ADMIN_HOME}" "${POSTGRES_DIR}" "${DREAM_DATA_ROOT}" "${ARTIFACT_DIR}"; do
  [[ ! -L "${target}" ]] || fail "Persistent directory must not be a symlink: ${target}"
done
if [[ ! -f "${POSTGRES_DIR}/PG_VERSION" ]]; then
  for legacy_dir in "${LEGACY_DREAM_POSTGRES_DIR}" "${LEGACY_ADMIN_POSTGRES_DIR}"; do
    if [[ "${legacy_dir}" != "${POSTGRES_DIR}" && -f "${legacy_dir}/PG_VERSION" ]]; then
      fail "Legacy PostgreSQL data exists at ${legacy_dir}; refusing automatic migration or empty-cluster startup."
    fi
  done
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${ADMIN_HOME}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0700 "${POSTGRES_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${DREAM_DATA_ROOT}" "${ARTIFACT_DIR}"

printf '[admin-data-init] PostgreSQL=%s Artifact=%s owner=%s:%s.\n' "${POSTGRES_DIR}" "${ARTIFACT_DIR}" "${SERVICE_USER}" "${SERVICE_GROUP}"
