#!/usr/bin/env bash
# [Input] REMOTE_* SSH settings, mode-0600 target env, and a local embedded PostgreSQL env/data directory.
# [Output] Admin/Gateway plus embedded PostgreSQL release workflow for Alibaba Cloud ECS.
# [Pos] Primary Admin-owned Remote SSH release; MinIO and standalone PostgreSQL are absent.
# [Sync] 2026-08-21: adopt portable compressed-SQL import, package migration, and embedded PG verification.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

REMOTE_SSH_HOST="${REMOTE_SSH_HOST:-}"
REMOTE_SSH_USER="${REMOTE_SSH_USER:-}"
REMOTE_SSH_PORT="${REMOTE_SSH_PORT:-22}"
REMOTE_SSH_KEY="${REMOTE_SSH_KEY:-}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-}"
REMOTE_COMPOSE_BIN="${REMOTE_COMPOSE_BIN:-docker-compose}"
REMOTE_COMPOSE_PROJECT_NAME="${REMOTE_COMPOSE_PROJECT_NAME:-ink-memory-admin}"
REMOTE_COMPOSE_FILE="${REMOTE_COMPOSE_FILE:-deploy/remote-ssh/docker-compose.yml}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-deploy/remote-ssh/.env}"
REMOTE_ADMIN_IMAGE="${REMOTE_ADMIN_IMAGE:-ink-memory-admin:remote}"
REMOTE_ADMIN_ROLLBACK_IMAGE="${REMOTE_ADMIN_ROLLBACK_IMAGE:-ink-memory-admin:remote-rollback}"
REMOTE_SETUP_NGINX="${REMOTE_SETUP_NGINX:-1}"
REMOTE_BUILD_PULL="${REMOTE_BUILD_PULL:-0}"
REMOTE_BUILD_NO_CACHE="${REMOTE_BUILD_NO_CACHE:-0}"
LOCAL_SOURCE_ENV_FILE="${LOCAL_SOURCE_ENV_FILE:-.env.local}"
DRY_RUN="${DRY_RUN:-0}"
COMMAND=""

log() { printf '[admin-remote] %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
err() { printf '[error] %s\n' "$*" >&2; exit 1; }
quote() { printf '%q' "$1"; }

usage() {
  cat <<'EOF'
Usage: ./deploy/remote-ssh/deploy.sh [--dry-run] <command>

Commands:
  check       Validate local config and remote Docker/nginx prerequisites.
  plan        Print the single-container release topology and order.
  sync        Rsync repository and ignored Alibaba Cloud env file.
  config      Sync and render remote Compose configuration.
  build       Sync, snapshot the current image, and build Admin.
  database    Initialize/check the package-managed embedded PostgreSQL volume.
  migrate     Run the Admin-owned @ink-memory/db migration outside app startup.
  deploy      Routine release: sync, build, migrate, start, and verify.
  bootstrap   First release: import the package-managed local embedded PG into an
              empty embedded database, migrate, start, and verify.
  verify      Check embedded PostgreSQL, Admin health, and local nginx routing.
  ps          Show Compose service status.
  logs        Follow Admin and embedded PostgreSQL logs.
  backup      Stop Admin briefly and create a consistent physical PG archive.
  rollback    Restart Admin with the previous image; data is unchanged.
  stop        Stop the Admin container; named volumes are preserved.

Required:
  REMOTE_SSH_HOST     ECS SSH host/IP
  REMOTE_APP_DIR      Absolute remote path, e.g. /srv/ink-admin-memory

Bootstrap reads the source cluster identity and credentials from mode-0600
LOCAL_SOURCE_ENV_FILE (default: .env.local). The source must use
INK_DATABASE_MODE=embedded-postgres and an existing explicit data directory.

Generate deploy/remote-ssh/.env first with prepare-env.sh. PostgreSQL listens
only inside the container/shared Docker network. FILE_STORAGE_TYPE is disabled;
no MinIO service or storage data migration runs.
EOF
}

env_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "${REPO_ROOT}/${REMOTE_ENV_FILE}"
}

source_env_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "${REPO_ROOT}/${LOCAL_SOURCE_ENV_FILE}"
}

ssh_target() {
  if [[ -n "${REMOTE_SSH_USER}" ]]; then printf '%s@%s\n' "${REMOTE_SSH_USER}" "${REMOTE_SSH_HOST:-REMOTE_SSH_HOST}"
  else printf '%s\n' "${REMOTE_SSH_HOST:-REMOTE_SSH_HOST}"
  fi
}

ssh_args() {
  SSH_ARGS=(-p "${REMOTE_SSH_PORT}")
  if [[ -n "${REMOTE_SSH_KEY}" ]]; then SSH_ARGS+=(-i "${REMOTE_SSH_KEY}"); fi
}

scp_args() {
  SCP_ARGS=(-P "${REMOTE_SSH_PORT}")
  if [[ -n "${REMOTE_SSH_KEY}" ]]; then SCP_ARGS+=(-i "${REMOTE_SSH_KEY}"); fi
}

ssh_run() {
  local cmd="$1"
  ssh_args
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] ssh'; printf ' %q' "${SSH_ARGS[@]}" "$(ssh_target)" "${cmd}"; printf '\n'
  else ssh "${SSH_ARGS[@]}" "$(ssh_target)" "${cmd}"
  fi
}

run() {
  if [[ "${DRY_RUN}" == "1" ]]; then printf '[dry-run]'; printf ' %q' "$@"; printf '\n'
  else "$@"
  fi
}

compose_prefix() {
  printf 'cd %s && env REMOTE_ADMIN_IMAGE=%s %s --env-file %s -p %s -f %s' \
    "$(quote "${REMOTE_APP_DIR}")" "$(quote "${REMOTE_ADMIN_IMAGE}")" \
    "$(quote "${REMOTE_COMPOSE_BIN}")" "$(quote "${REMOTE_ENV_FILE}")" \
    "$(quote "${REMOTE_COMPOSE_PROJECT_NAME}")" "$(quote "${REMOTE_COMPOSE_FILE}")"
}

remote_compose() {
  local cmd arg
  cmd="$(compose_prefix)"
  for arg in "$@"; do cmd+=" $(quote "${arg}")"; done
  ssh_run "${cmd}"
}

require_config() {
  [[ -n "${REMOTE_SSH_HOST}" ]] || err "REMOTE_SSH_HOST is required."
  [[ -n "${REMOTE_APP_DIR}" ]] || err "REMOTE_APP_DIR is required."
  [[ "${REMOTE_APP_DIR}" == /* ]] || err "REMOTE_APP_DIR must be absolute."
}

check_local() {
  local failed=0 mode
  for command_name in ssh scp rsync; do command -v "${command_name}" >/dev/null 2>&1 || { warn "${command_name} not found."; failed=1; }; done
  for file in "${REPO_ROOT}/${REMOTE_COMPOSE_FILE}" "${REPO_ROOT}/${REMOTE_ENV_FILE}" \
    "${REPO_ROOT}/deploy/remote-ssh/nginx.conf.template" "${REPO_ROOT}/docker/Dockerfile"; do
    [[ -f "${file}" ]] || { warn "Missing ${file}."; failed=1; }
  done
  if [[ -f "${REPO_ROOT}/${REMOTE_ENV_FILE}" ]]; then
    mode="$(stat -f '%Lp' "${REPO_ROOT}/${REMOTE_ENV_FILE}" 2>/dev/null || stat -c '%a' "${REPO_ROOT}/${REMOTE_ENV_FILE}")"
    [[ "${mode}" == "600" ]] || { warn "${REMOTE_ENV_FILE} must have mode 600, got ${mode}."; failed=1; }
    for key in REMOTE_PLATFORM_NETWORK REMOTE_ADMIN_DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
      ADMIN_SESSION_SECRET GATEWAY_API_KEY_PEPPER AI_CREDENTIAL_ENCRYPTION_KEY PRODUCT_API_JWT_SECRET; do
      [[ -n "$(env_value "${key}")" ]] || { warn "${key} is missing from ${REMOTE_ENV_FILE}."; failed=1; }
    done
    [[ "$(env_value FILE_STORAGE_TYPE)" == "disabled" ]] || { warn "FILE_STORAGE_TYPE must be disabled while MinIO is paused."; failed=1; }
  fi
  [[ "${failed}" == "0" ]]
}

check_remote() {
  require_config
  ssh_run "command -v $(quote "${REMOTE_COMPOSE_BIN}") >/dev/null && $(quote "${REMOTE_COMPOSE_BIN}") version >/dev/null && docker info >/dev/null && command -v nginx >/dev/null && nginx -t >/dev/null"
}

command_check() { require_config; check_local; check_remote; log "Remote SSH Admin prerequisites are usable."; }

command_plan() {
  cat <<EOF
Admin-owned Alibaba Cloud release:
  1. Build one Admin/Gateway image containing @ink-memory/db and PostgreSQL binaries.
  2. Persist embedded PostgreSQL and artifacts in Admin-owned named volumes.
  3. Run the hash-verified Drizzle migration once before Admin startup.
  4. Expose Admin through host nginx; Dream joins the shared network and uses
     aliases ink-memory-admin and ink-memory-postgres.
  5. Object storage is explicitly disabled; no MinIO container is created.

Routine:   ./deploy/remote-ssh/deploy.sh deploy
First use: ./deploy/remote-ssh/deploy.sh bootstrap
Remote directory: ${REMOTE_APP_DIR:-<required>}
Compose project:  ${REMOTE_COMPOSE_PROJECT_NAME}
EOF
}

sync_files() {
  require_config; check_local
  ssh_run "mkdir -p $(quote "${REMOTE_APP_DIR}") $(quote "${REMOTE_APP_DIR}/backups")"
  local transport="ssh -p $(quote "${REMOTE_SSH_PORT}")"
  [[ -n "${REMOTE_SSH_KEY}" ]] && transport+=" -i $(quote "${REMOTE_SSH_KEY}")"
  local args=(-az --delete --include '/deploy/' --include '/deploy/remote-ssh/' --include '/deploy/remote-ssh/.env'
    --exclude '/.git/' --exclude '/.env*' --exclude '/docker/.env' --exclude '**/.env'
    --exclude '/backups/' --exclude '/node_modules/' --exclude '/.next*/' --exclude '/.ink-memory/'
    --exclude '/.artifacts/' --exclude '/agent-workspaces/' --exclude '/packages/*/dist/'
    --exclude '/tmp/' --exclude '/output/' --exclude '/html/' --exclude '/test-results/'
    --exclude '/playwright-report/' --exclude '/tsconfig.tsbuildinfo' --exclude '.DS_Store' -e "${transport}")
  log "Syncing Admin repository to $(ssh_target):${REMOTE_APP_DIR}."
  run rsync "${args[@]}" "${REPO_ROOT}/" "$(ssh_target):${REMOTE_APP_DIR}/"
}

ensure_network() {
  local network="$(env_value REMOTE_PLATFORM_NETWORK)"
  ssh_run "docker network inspect $(quote "${network}") >/dev/null 2>&1 || docker network create $(quote "${network}") >/dev/null"
}

setup_nginx() {
  [[ "${REMOTE_SETUP_NGINX}" == "1" ]] || { log "Skipping nginx setup."; return 0; }
  local domain bind_host port rendered remote_tmp
  domain="$(env_value REMOTE_ADMIN_DOMAIN)"; bind_host="$(env_value REMOTE_ADMIN_BIND_HOST)"; port="$(env_value REMOTE_ADMIN_PORT)"
  [[ "${domain}" =~ ^[A-Za-z0-9.-]+$ ]] || err "Invalid REMOTE_ADMIN_DOMAIN."
  [[ "${bind_host}" =~ ^[0-9A-Fa-f:.]+$ ]] || err "Invalid REMOTE_ADMIN_BIND_HOST."
  [[ "${port}" =~ ^[0-9]+$ ]] || err "Invalid REMOTE_ADMIN_PORT."
  rendered="$(mktemp "${SCRIPT_DIR}/nginx.XXXXXX")"; trap 'rm -f "${rendered}"' RETURN
  sed -e "s/__ADMIN_DOMAIN__/${domain}/g" -e "s/__ADMIN_BIND_HOST__/${bind_host}/g" -e "s/__ADMIN_PORT__/${port}/g" "${SCRIPT_DIR}/nginx.conf.template" >"${rendered}"
  remote_tmp="/tmp/ink-memory-admin.conf"; scp_args
  if [[ "${DRY_RUN}" == "1" ]]; then printf '[dry-run] scp'; printf ' %q' "${SCP_ARGS[@]}" "${rendered}" "$(ssh_target):${remote_tmp}"; printf '\n'
  else scp "${SCP_ARGS[@]}" "${rendered}" "$(ssh_target):${remote_tmp}"
  fi
  ssh_run "set -e; target=/etc/nginx/sites-available/ink-memory-admin; enabled=/etc/nginx/sites-enabled/ink-memory-admin; conflict=\$(grep -RIl --include='*.conf' --include='*' 'server_name[[:space:]].*${domain}' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | grep -v \"\${enabled}\" || true); test -z \"\${conflict}\" || { echo \"Conflicting nginx config: \${conflict}\" >&2; exit 1; }; cp $(quote "${remote_tmp}") \"\${target}\"; ln -sfn \"\${target}\" \"\${enabled}\"; rm -f $(quote "${remote_tmp}"); nginx -t; systemctl reload nginx"
  rm -f "${rendered}"; trap - RETURN; log "Nginx configured for ${domain}."
}

snapshot_image() { ssh_run "docker image inspect $(quote "${REMOTE_ADMIN_IMAGE}") >/dev/null 2>&1 && docker tag $(quote "${REMOTE_ADMIN_IMAGE}") $(quote "${REMOTE_ADMIN_ROLLBACK_IMAGE}") || true"; }

build_image() {
  local args=(build)
  [[ "${REMOTE_BUILD_NO_CACHE}" == "1" ]] && args+=(--no-cache)
  [[ "${REMOTE_BUILD_PULL}" == "1" ]] && args+=(--pull)
  log "Building single Admin/embedded-PostgreSQL image."
  remote_compose "${args[@]}" ink-memory-admin
}

initialize_database() {
  log "Initializing or checking the package-managed embedded PostgreSQL volume."
  remote_compose run --rm --no-deps ink-memory-admin node /app/packages/db/dist/health.js
}

run_migration() {
  log "Running the single Admin-owned @ink-memory/db migration step."
  remote_compose run --rm --no-deps ink-memory-admin node /app/packages/db/dist/migrate.js
  remote_compose run --rm --no-deps ink-memory-admin node /app/packages/db/dist/migrate.js --check
}

start_admin() { remote_compose up -d --no-deps --force-recreate ink-memory-admin; }

verify() {
  local domain="$(env_value REMOTE_ADMIN_DOMAIN)" port="$(env_value REMOTE_ADMIN_PORT)"
  remote_compose exec -T ink-memory-admin node /app/packages/db/dist/health.js >/dev/null
  ssh_run "curl -fsS --retry 12 --retry-delay 5 --retry-connrefused --max-time 15 $(quote "http://127.0.0.1:${port}/admin/login") >/dev/null && curl -fsS --retry 6 --retry-delay 5 --retry-connrefused --max-time 15 -H $(quote "Host: ${domain}") http://127.0.0.1/admin/login >/dev/null"
  remote_compose ps
  log "Admin and embedded PostgreSQL verification passed; object storage remains disabled."
}

seed_database() {
  local source_env="${REPO_ROOT}/${LOCAL_SOURCE_ENV_FILE}" source_mode source_data_dir
  local source_port source_user source_password source_database source_env_mode
  [[ -f "${source_env}" ]] || err "Local embedded source env not found: ${source_env}."
  source_env_mode="$(stat -f '%Lp' "${source_env}" 2>/dev/null || stat -c '%a' "${source_env}")"
  [[ "${source_env_mode}" == "600" ]] || err "${LOCAL_SOURCE_ENV_FILE} must have mode 600, got ${source_env_mode}."
  source_mode="$(source_env_value INK_DATABASE_MODE)"
  source_data_dir="$(source_env_value EMBEDDED_POSTGRES_DATA_DIR)"
  source_port="$(source_env_value EMBEDDED_POSTGRES_PORT)"
  source_user="$(source_env_value POSTGRES_USER)"
  source_password="$(source_env_value POSTGRES_PASSWORD)"
  source_database="$(source_env_value POSTGRES_DB)"
  [[ "${source_mode}" == "embedded-postgres" ]] || err "Local source must set INK_DATABASE_MODE=embedded-postgres."
  [[ "${source_data_dir}" == /* ]] || err "Local source EMBEDDED_POSTGRES_DATA_DIR must be absolute."
  [[ -f "${source_data_dir}/PG_VERSION" ]] || err "Local embedded PostgreSQL cluster is missing PG_VERSION."
  [[ "${source_port}" =~ ^[0-9]+$ ]] || err "Local source EMBEDDED_POSTGRES_PORT is invalid."
  [[ -n "${source_user}" && -n "${source_password}" && -n "${source_database}" ]] || err "Local source PostgreSQL identity is incomplete."
  command -v node >/dev/null 2>&1 || err "Local node is required for bootstrap."
  command -v pnpm >/dev/null 2>&1 || err "Local pnpm is required for bootstrap."
  command -v pg_dump >/dev/null 2>&1 || err "Local pg_dump is required for bootstrap."
  command -v gzip >/dev/null 2>&1 || err "Local gzip is required for bootstrap."
  [[ "${DRY_RUN}" != "1" ]] || { log "Would start the exact local embedded source, dump it, and restore only into an empty target."; return 0; }
  local dump_file plain_file dump_name remote_dump
  dump_file="$(mktemp "${TMPDIR:-/tmp}/ink-memory-bootstrap.XXXXXX.sql.gz")"; trap 'rm -f "${dump_file}"' RETURN
  plain_file="${dump_file%.gz}"; trap 'rm -f "${dump_file}" "${plain_file}"' RETURN
  log "Creating a consistent compressed SQL dump from the package-managed local embedded PostgreSQL; contents will not be printed."
  pnpm --filter @ink-memory/db build >/dev/null
  env INK_DATABASE_MODE=embedded-postgres EMBEDDED_POSTGRES_DATA_DIR="${source_data_dir}" \
    EMBEDDED_POSTGRES_PORT="${source_port}" POSTGRES_USER="${source_user}" \
    POSTGRES_PASSWORD="${source_password}" POSTGRES_DB="${source_database}" \
    RUN_DB_MIGRATIONS=false node packages/db/dist/supervise.js \
    pg_dump --format=plain --no-owner --no-privileges --host=127.0.0.1 \
    --port="${source_port}" --username="${source_user}" --dbname="${source_database}" \
    --file="${plain_file}"
  gzip -c "${plain_file}" >"${dump_file}"
  [[ -s "${dump_file}" ]] || err "Local PostgreSQL dump is empty."
  dump_name="ink-memory-bootstrap-$(date +%Y%m%d_%H%M%S).sql.gz"; remote_dump="${REMOTE_APP_DIR}/backups/${dump_name}"; scp_args
  run scp "${SCP_ARGS[@]}" "${dump_file}" "$(ssh_target):${remote_dump}"
  remote_compose run --rm --no-deps -v "${remote_dump}:/backup/bootstrap.sql.gz:ro" ink-memory-admin node /app/packages/db/dist/database-io.js restore-sql-gzip /backup/bootstrap.sql.gz
  rm -f "${dump_file}" "${plain_file}"; trap - RETURN
  log "Imported the source into the empty embedded PostgreSQL volume; dump retained at ${remote_dump}."
}

backup_database() {
  local timestamp archive volume
  timestamp="$(date +%Y%m%d_%H%M%S)"; archive="ink-memory-postgres-${timestamp}.tar.gz"; volume="${REMOTE_COMPOSE_PROJECT_NAME}_ink_memory_postgres_data"
  log "Stopping Admin briefly for a consistent physical PostgreSQL archive."
  remote_compose stop ink-memory-admin
  if ssh_run "mkdir -p $(quote "${REMOTE_APP_DIR}/backups") && docker run --rm --entrypoint tar -v $(quote "${volume}:/data:ro") -v $(quote "${REMOTE_APP_DIR}/backups:/backups") $(quote "${REMOTE_ADMIN_IMAGE}") -C /data -czf $(quote "/backups/${archive}") . && test -s $(quote "${REMOTE_APP_DIR}/backups/${archive}")"; then
    start_admin; verify; log "Physical PostgreSQL backup created: ${REMOTE_APP_DIR}/backups/${archive}"
  else
    start_admin; err "Physical PostgreSQL backup failed; Admin was restarted."
  fi
}

routine_deploy() {
  command_check; setup_nginx; sync_files; ensure_network; snapshot_image; build_image; run_migration; start_admin; verify
}

bootstrap_deploy() {
  command_check; setup_nginx; sync_files; ensure_network; snapshot_image; build_image; seed_database; run_migration; start_admin; verify
}

rollback() {
  ssh_run "docker image inspect $(quote "${REMOTE_ADMIN_ROLLBACK_IMAGE}") >/dev/null"
  local current_image="${REMOTE_ADMIN_IMAGE}"; REMOTE_ADMIN_IMAGE="${REMOTE_ADMIN_ROLLBACK_IMAGE}"
  remote_compose up -d --no-build --no-deps --force-recreate ink-memory-admin
  REMOTE_ADMIN_IMAGE="${current_image}"; verify
  log "Admin image rolled back; the embedded PostgreSQL volume was not changed."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) [[ -z "${COMMAND}" ]] || err "Unexpected argument: $1"; COMMAND="$1"; shift ;;
  esac
done

case "${COMMAND:-help}" in
  help) usage ;;
  check) command_check ;;
  plan) command_plan ;;
  sync) require_config; sync_files ;;
  config) command_check; sync_files; ensure_network; remote_compose config ;;
  build) command_check; sync_files; ensure_network; snapshot_image; build_image ;;
  database|infra) command_check; initialize_database ;;
  migrate) command_check; run_migration ;;
  deploy|start|up) routine_deploy ;;
  bootstrap) bootstrap_deploy ;;
  verify) command_check; verify ;;
  ps) require_config; remote_compose ps ;;
  logs) require_config; remote_compose logs -f --tail=100 ink-memory-admin ;;
  backup) command_check; backup_database ;;
  rollback) command_check; rollback ;;
  stop) require_config; remote_compose down ;;
  *) err "Unknown command: ${COMMAND}. Run --help." ;;
esac
