#!/usr/bin/env bash
# [Input] AutoDL SSH settings, generated runtime env, source tree, and optional bootstrap database.
# [Output] Versioned direct-host Admin/embedded-PostgreSQL release managed by screen.
# [Pos] AutoDL release entry; deliberately uses neither Docker nor nginx.
# [Sync] 2026-08-26: place Admin home and PostgreSQL under /root/ink-autodl/data.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
AUTODL_PLATFORM_ENV_FILE="${AUTODL_PLATFORM_ENV_FILE:-${SCRIPT_DIR}/platform.env}"
if [[ -f "${AUTODL_PLATFORM_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090 -- the operator explicitly selects this local platform file.
  source "${AUTODL_PLATFORM_ENV_FILE}"
fi
AUTODL_SSH_HOST="${AUTODL_SSH_HOST:-}"
AUTODL_SSH_USER="${AUTODL_SSH_USER:-root}"
AUTODL_SSH_PORT="${AUTODL_SSH_PORT:-22}"
AUTODL_SSH_KEY="${AUTODL_SSH_KEY:-}"
AUTODL_SSH_CONTROL_PATH="${AUTODL_SSH_CONTROL_PATH:-}"
AUTODL_APP_ROOT="${AUTODL_APP_ROOT:-/root/ink-autodl/admin}"
AUTODL_DATA_ROOT="${AUTODL_DATA_ROOT:-/root/autodl-tmp/ink-memory}"
AUTODL_ADMIN_HOME="${AUTODL_ADMIN_HOME:-/root/ink-autodl/data}"
AUTODL_ENV_FILE="${AUTODL_ENV_FILE:-${SCRIPT_DIR}/.env}"
AUTODL_SOURCE_ENV_FILE="${AUTODL_SOURCE_ENV_FILE:-${REPO_ROOT}/.env.local}"
AUTODL_SERVICE_USER="${AUTODL_SERVICE_USER:-ink-memory}"
AUTODL_NODE_VERSION="${AUTODL_NODE_VERSION:-22.18.0}"
AUTODL_ADMIN_PORT="${AUTODL_ADMIN_PORT:-6008}"
AUTODL_ADMIN_PUBLIC_ORIGIN="${AUTODL_ADMIN_PUBLIC_ORIGIN:-}"
AUTODL_SCREEN_NAME="${AUTODL_ADMIN_SCREEN_NAME:-ink-admin}"
AUTODL_BUILD_CPUS="${AUTODL_BUILD_CPUS:-1}"
AUTODL_BUILD_MAX_OLD_SPACE_MB="${AUTODL_BUILD_MAX_OLD_SPACE_MB:-1024}"
AUTODL_BOOTSTRAP_DUMP="${AUTODL_BOOTSTRAP_DUMP:-}"
DRY_RUN=0
COMMAND=""

log() { printf '[admin-autodl] %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
err() { printf '[error] %s\n' "$*" >&2; exit 1; }
quote() { printf '%q' "$1"; }

usage() {
  cat <<'EOF'
Usage: ./deploy/autodl-ssh/deploy.sh [--dry-run] <command>

Commands:
  check      Validate local files, SSH, and target identity without mutation.
  plan       Print the direct-host release sequence.
  sync       Rsync source and the generated mode-0640 runtime env.
  build      Install host prerequisites, sync, and build a versioned release.
  bootstrap  First release only: import the current local embedded PG, migrate,
             start, and verify. The target must contain zero user tables.
  bootstrap-resume
             Reuse an existing dump under AUTODL_APP_ROOT/backups after a
             failed first-release attempt; requires AUTODL_BOOTSTRAP_DUMP.
  deploy     Routine release: build, stop Admin, migrate, start, and verify.
  migrate    Stop Admin, run Admin-owned Drizzle migrations, and restart it.
  start|stop|status|logs|verify|rollback

Required: AUTODL_SSH_HOST, AUTODL_ADMIN_PUBLIC_ORIGIN, deploy/autodl-ssh/.env.
AUTODL_SSH_CONTROL_PATH may point to an active password-authenticated SSH master.
EOF
}

ssh_args() {
  SSH_ARGS=(-p "${AUTODL_SSH_PORT}" -o BatchMode=yes)
  [[ -n "${AUTODL_SSH_KEY}" ]] && SSH_ARGS+=(-i "${AUTODL_SSH_KEY}")
  [[ -n "${AUTODL_SSH_CONTROL_PATH}" ]] && SSH_ARGS+=(-o "ControlPath=${AUTODL_SSH_CONTROL_PATH}")
}

ssh_target() { printf '%s@%s\n' "${AUTODL_SSH_USER}" "${AUTODL_SSH_HOST:-AUTODL_SSH_HOST}"; }

remote() {
  local command="$1"
  ssh_args
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] ssh'; printf ' %q' "${SSH_ARGS[@]}" "$(ssh_target)" "${command}"; printf '\n'
  else
    ssh "${SSH_ARGS[@]}" "$(ssh_target)" "${command}"
  fi
}

scp_file() {
  local source="$1" target="$2"
  local args=(-P "${AUTODL_SSH_PORT}" -o BatchMode=yes)
  [[ -n "${AUTODL_SSH_KEY}" ]] && args+=(-i "${AUTODL_SSH_KEY}")
  [[ -n "${AUTODL_SSH_CONTROL_PATH}" ]] && args+=(-o "ControlPath=${AUTODL_SSH_CONTROL_PATH}")
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] scp'; printf ' %q' "${args[@]}" "${source}" "$(ssh_target):${target}"; printf '\n'
  else
    scp "${args[@]}" "${source}" "$(ssh_target):${target}"
  fi
}

require_config() {
  [[ -n "${AUTODL_SSH_HOST}" ]] || err "AUTODL_SSH_HOST is required."
  [[ "${AUTODL_SSH_USER}" == "root" ]] || err "AutoDL setup currently requires the root SSH account."
  [[ "${AUTODL_APP_ROOT}" == /root/* && "${AUTODL_DATA_ROOT}" == /root/* ]] || err "AutoDL paths must stay under /root."
  [[ "${AUTODL_ADMIN_HOME}" == /* && "${AUTODL_ADMIN_HOME}" != "${AUTODL_DATA_ROOT}" && "${AUTODL_ADMIN_HOME}" != "${AUTODL_DATA_ROOT}/"* ]] || err "AUTODL_ADMIN_HOME must be absolute and outside AUTODL_DATA_ROOT."
  [[ "${AUTODL_ADMIN_PORT}" == "6008" ]] || err "Admin AutoDL mapping must use local port 6008."
  [[ "${AUTODL_BUILD_CPUS}" =~ ^[1-9][0-9]*$ ]] || err "AUTODL_BUILD_CPUS must be a positive integer."
  [[ "${AUTODL_BUILD_MAX_OLD_SPACE_MB}" =~ ^[1-9][0-9]*$ ]] || err "AUTODL_BUILD_MAX_OLD_SPACE_MB must be a positive integer."
}

check_local() {
  local failed=0 mode
  for name in ssh scp rsync git gzip pg_dump; do command -v "${name}" >/dev/null 2>&1 || { warn "Missing local command: ${name}"; failed=1; }; done
  for file in "${AUTODL_ENV_FILE}" "${SCRIPT_DIR}/runtime/start-admin.sh" "${SCRIPT_DIR}/runtime/init-admin-data.sh"; do
    [[ -f "${file}" ]] || { warn "Missing file: ${file}"; failed=1; }
  done
  if [[ -f "${AUTODL_ENV_FILE}" ]]; then
    mode="$(stat -f '%Lp' "${AUTODL_ENV_FILE}" 2>/dev/null || stat -c '%a' "${AUTODL_ENV_FILE}")"
    [[ "${mode}" == "640" || "${mode}" == "600" ]] || { warn "${AUTODL_ENV_FILE} must be mode 600 or 640, got ${mode}."; failed=1; }
  fi
  [[ "${failed}" == "0" ]]
}

check_remote() {
  remote "set -e; test \"\$(id -u)\" = 0; test -d /root/autodl-tmp; command -v curl >/dev/null; command -v rsync >/dev/null; command -v screen >/dev/null"
}

command_check() { require_config; check_local; check_remote; log "AutoDL Admin prerequisites and target identity are valid."; }

command_plan() {
  cat <<EOF
AutoDL Admin direct-host release:
  SSH target:      $(ssh_target):${AUTODL_APP_ROOT}
  local mapping:   http://127.0.0.1:${AUTODL_ADMIN_PORT}
  public mapping:  ${AUTODL_ADMIN_PUBLIC_ORIGIN:-<required>}
  PostgreSQL:      ${AUTODL_ADMIN_HOME}/postgres
  shared Artifact: ${AUTODL_DATA_ROOT}/artifacts
  build budget:    ${AUTODL_BUILD_CPUS} CPU / ${AUTODL_BUILD_MAX_OLD_SPACE_MB} MiB V8 old-space
  runtime:         Node ${AUTODL_NODE_VERSION} + screen + non-root embedded PostgreSQL
  order:           setup -> sync -> build -> restore(first use only) -> migrate -> start -> verify
  excluded:        Docker, nginx, runtime DDL, plaintext secret logging
EOF
}

setup_host() {
  log "Installing bounded direct-host prerequisites and Node ${AUTODL_NODE_VERSION}."
  remote "set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends ca-certificates curl xz-utils acl passwd screen jq iproute2 postgresql-common >/dev/null
install -d /usr/share/postgresql-common/pgdg
test -f /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc || curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
printf '%s\n' 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main' >/etc/apt/sources.list.d/pgdg.list
apt-get update >/dev/null
apt-get install -y --no-install-recommends postgresql-client-18 >/dev/null
id -u $(quote "${AUTODL_SERVICE_USER}") >/dev/null 2>&1 || adduser --system --group --home $(quote "${AUTODL_ADMIN_HOME}") --shell /usr/sbin/nologin $(quote "${AUTODL_SERVICE_USER}") >/dev/null
usermod --home $(quote "${AUTODL_ADMIN_HOME}") $(quote "${AUTODL_SERVICE_USER}")
setfacl -m u:$(quote "${AUTODL_SERVICE_USER}"):--x /root
install -d -m 0750 $(quote "${AUTODL_APP_ROOT}") $(quote "${AUTODL_APP_ROOT}/source") $(quote "${AUTODL_APP_ROOT}/releases") $(quote "${AUTODL_APP_ROOT}/config") $(quote "${AUTODL_APP_ROOT}/run") $(quote "${AUTODL_APP_ROOT}/logs")
setfacl -m u:$(quote "${AUTODL_SERVICE_USER}"):--x /root/ink-autodl $(quote "${AUTODL_APP_ROOT}") $(quote "${AUTODL_APP_ROOT}/releases")
chgrp $(quote "${AUTODL_SERVICE_USER}") $(quote "${AUTODL_APP_ROOT}/config")
chmod 0750 $(quote "${AUTODL_APP_ROOT}/config")
chown $(quote "${AUTODL_SERVICE_USER}"):$(quote "${AUTODL_SERVICE_USER}") $(quote "${AUTODL_APP_ROOT}/run") $(quote "${AUTODL_APP_ROOT}/logs")
install -d -o $(quote "${AUTODL_SERVICE_USER}") -g $(quote "${AUTODL_SERVICE_USER}") -m 0750 $(quote "${AUTODL_ADMIN_HOME}") $(quote "${AUTODL_DATA_ROOT}/artifacts")
install -d -o $(quote "${AUTODL_SERVICE_USER}") -g $(quote "${AUTODL_SERVICE_USER}") -m 0700 $(quote "${AUTODL_ADMIN_HOME}/postgres")
node_root=/root/ink-autodl/runtime/node-v${AUTODL_NODE_VERSION}-linux-x64
if [ ! -x \"\${node_root}/bin/node\" ]; then
  install -d /root/ink-autodl/runtime
  archive=/root/ink-autodl/runtime/node-v${AUTODL_NODE_VERSION}-linux-x64.tar.xz
  curl -fsSL --retry 5 -o \"\${archive}\" https://nodejs.org/dist/v${AUTODL_NODE_VERSION}/node-v${AUTODL_NODE_VERSION}-linux-x64.tar.xz
  tar -xJf \"\${archive}\" -C /root/ink-autodl/runtime
  rm -f \"\${archive}\"
fi
ln -sfn \"\${node_root}\" /root/ink-autodl/runtime/node
PATH=/root/ink-autodl/runtime/node/bin:\$PATH corepack enable
PATH=/root/ink-autodl/runtime/node/bin:\$PATH corepack prepare pnpm@9.15.0 --activate >/dev/null
setfacl -m u:$(quote "${AUTODL_SERVICE_USER}"):--x /root/ink-autodl/runtime
setfacl -R -m u:$(quote "${AUTODL_SERVICE_USER}"):rX /root/ink-autodl/runtime/node
/root/ink-autodl/runtime/node/bin/node --version
psql --version"
}

sync_files() {
  require_config; check_local
  remote "install -d -m 0750 $(quote "${AUTODL_APP_ROOT}/source") $(quote "${AUTODL_APP_ROOT}/config")"
  local transport="ssh -p $(quote "${AUTODL_SSH_PORT}") -o BatchMode=yes"
  [[ -n "${AUTODL_SSH_KEY}" ]] && transport+=" -i $(quote "${AUTODL_SSH_KEY}")"
  [[ -n "${AUTODL_SSH_CONTROL_PATH}" ]] && transport+=" -o ControlPath=$(quote "${AUTODL_SSH_CONTROL_PATH}")"
  local args=(-az --delete --exclude '/.git/' --exclude '/.env*' --exclude '/node_modules/' --exclude '/.next/' --exclude '/.ink-memory/' --exclude '/backups/' --exclude '/test-results/' --exclude '/playwright-report/' --exclude '/deploy/remote-ssh/.env' --exclude '/deploy/autodl-ssh/.env' -e "${transport}")
  log "Syncing Admin source without runtime secrets."
  if [[ "${DRY_RUN}" == "1" ]]; then printf '[dry-run] rsync'; printf ' %q' "${args[@]}" "${REPO_ROOT}/" "$(ssh_target):${AUTODL_APP_ROOT}/source/"; printf '\n';
  else rsync "${args[@]}" "${REPO_ROOT}/" "$(ssh_target):${AUTODL_APP_ROOT}/source/"; fi
  remote "INK_AUTODL_ADMIN_HOME=$(quote "${AUTODL_ADMIN_HOME}") INK_AUTODL_DATA_ROOT=$(quote "${AUTODL_DATA_ROOT}") INK_AUTODL_SERVICE_USER=$(quote "${AUTODL_SERVICE_USER}") $(quote "${AUTODL_APP_ROOT}/source/deploy/autodl-ssh/runtime/init-admin-data.sh")"
  scp_file "${AUTODL_ENV_FILE}" "${AUTODL_APP_ROOT}/config/admin.env.next"
  remote "set -e; group=\$(id -gn $(quote "${AUTODL_SERVICE_USER}")); chown root:\"\${group}\" $(quote "${AUTODL_APP_ROOT}/config/admin.env.next"); chmod 0640 $(quote "${AUTODL_APP_ROOT}/config/admin.env.next"); mv -f $(quote "${AUTODL_APP_ROOT}/config/admin.env.next") $(quote "${AUTODL_APP_ROOT}/config/admin.env")"
}

build_release() {
  local release_id
  release_id="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
  log "Building Admin release ${release_id} on AutoDL."
  remote "set -euo pipefail
export PATH=/root/ink-autodl/runtime/node/bin:\$PATH
cd $(quote "${AUTODL_APP_ROOT}/source")
pnpm install --frozen-lockfile
NEXT_STANDALONE_OUTPUT=true NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_CPUS=${AUTODL_BUILD_CPUS} NODE_OPTIONS=--max-old-space-size=${AUTODL_BUILD_MAX_OLD_SPACE_MB} pnpm build
staging=$(quote "${AUTODL_APP_ROOT}/releases/${release_id}.staging")
release=$(quote "${AUTODL_APP_ROOT}/releases/${release_id}")
db_runtime=$(quote "${AUTODL_APP_ROOT}/releases/${release_id}.db-runtime")
rm -rf \"\${staging}\"
rm -rf \"\${db_runtime}\"
install -d \"\${staging}/.next\" \"\${staging}/packages\"
cp -a .next/standalone/. \"\${staging}/\"
cp -a .next/static \"\${staging}/.next/static\"
cp -a drizzle \"\${staging}/drizzle\"
pnpm --filter @ink-memory/db deploy --prod \"\${db_runtime}\"
rm -rf \"\${staging}/packages/db\"
mv \"\${db_runtime}\" \"\${staging}/packages/db\"
cp deploy/autodl-ssh/runtime/start-admin.sh \"\${staging}/start-admin.sh\"
cp deploy/autodl-ssh/runtime/assert-bootstrap.mjs \"\${staging}/packages/db/dist/assert-bootstrap.mjs\"
chmod 0755 \"\${staging}/start-admin.sh\"
test -f \"\${staging}/server.js\"
test -f \"\${staging}/packages/db/dist/supervise.js\"
rm -rf \"\${release}\"
mv \"\${staging}\" \"\${release}\"
chown -R $(quote "${AUTODL_SERVICE_USER}"):$(quote "${AUTODL_SERVICE_USER}") \"\${release}\"
if [ -L $(quote "${AUTODL_APP_ROOT}/current") ]; then ln -sfn \"\$(readlink -f $(quote "${AUTODL_APP_ROOT}/current"))\" $(quote "${AUTODL_APP_ROOT}/previous"); fi
ln -sfn \"\${release}\" $(quote "${AUTODL_APP_ROOT}/current")"
}

stop_admin() {
  remote "set -e; pid_file=$(quote "${AUTODL_APP_ROOT}/run/admin.pid"); if [ -f \"\${pid_file}\" ]; then pid=\$(cat \"\${pid_file}\"); if echo \"\${pid}\" | grep -Eq '^[0-9]+$' && kill -0 \"\${pid}\" 2>/dev/null; then kill -TERM \"\${pid}\"; for _ in \$(seq 1 60); do kill -0 \"\${pid}\" 2>/dev/null || break; sleep 1; done; kill -0 \"\${pid}\" 2>/dev/null && kill -KILL \"\${pid}\" || true; fi; rm -f \"\${pid_file}\"; fi; screen -S $(quote "${AUTODL_SCREEN_NAME}") -X quit >/dev/null 2>&1 || true"
}

maintenance() {
  local script="$1"; shift
  local arguments="" argument
  for argument in "$@"; do arguments+=" $(quote "${argument}")"; done
  remote "set -euo pipefail
set -a; . $(quote "${AUTODL_APP_ROOT}/config/admin.env"); set +a
export HOME=$(quote "${AUTODL_ADMIN_HOME}")
export PATH=/root/ink-autodl/runtime/node/bin:/usr/lib/postgresql/18/bin:\$PATH
export INK_MIGRATIONS_DIR=$(quote "${AUTODL_APP_ROOT}/current/drizzle")
uid=\$(id -u $(quote "${AUTODL_SERVICE_USER}")); gid=\$(id -g $(quote "${AUTODL_SERVICE_USER}"))
cd $(quote "${AUTODL_APP_ROOT}/current")
setpriv --reuid=\"\${uid}\" --regid=\"\${gid}\" --init-groups node packages/db/dist/supervise.js node packages/db/dist/$(quote "${script}")${arguments}"
}

start_admin() {
  remote "set -euo pipefail
INK_AUTODL_ADMIN_HOME=$(quote "${AUTODL_ADMIN_HOME}") INK_AUTODL_DATA_ROOT=$(quote "${AUTODL_DATA_ROOT}") INK_AUTODL_SERVICE_USER=$(quote "${AUTODL_SERVICE_USER}") $(quote "${AUTODL_APP_ROOT}/source/deploy/autodl-ssh/runtime/init-admin-data.sh")
test -L $(quote "${AUTODL_APP_ROOT}/current")
uid=\$(id -u $(quote "${AUTODL_SERVICE_USER}")); gid=\$(id -g $(quote "${AUTODL_SERVICE_USER}"))
rm -f $(quote "${AUTODL_APP_ROOT}/run/admin.pid")
screen -S $(quote "${AUTODL_SCREEN_NAME}") -X quit >/dev/null 2>&1 || true
screen -dmS $(quote "${AUTODL_SCREEN_NAME}") -L -Logfile $(quote "${AUTODL_APP_ROOT}/logs/admin.log") bash -lc \"exec setpriv --reuid=\${uid} --regid=\${gid} --init-groups env HOME=$(quote "${AUTODL_ADMIN_HOME}") AUTODL_ADMIN_ENV_FILE=$(quote "${AUTODL_APP_ROOT}/config/admin.env") AUTODL_ADMIN_PID_FILE=$(quote "${AUTODL_APP_ROOT}/run/admin.pid") AUTODL_NODE_BIN=/root/ink-autodl/runtime/node/bin $(quote "${AUTODL_APP_ROOT}/current/start-admin.sh")\"
for _ in \$(seq 1 90); do curl -fsS --max-time 3 http://127.0.0.1:${AUTODL_ADMIN_PORT}/admin/login >/dev/null 2>&1 && exit 0; sleep 1; done
tail -n 120 $(quote "${AUTODL_APP_ROOT}/logs/admin.log") >&2 || true
exit 1"
}

create_dump() {
  local dump_file="$1" user password database port
  [[ -f "${AUTODL_SOURCE_ENV_FILE}" ]] || err "Missing bootstrap source env: ${AUTODL_SOURCE_ENV_FILE}"
  user="$(awk -F= '$1 == "POSTGRES_USER" { print substr($0, index($0, "=") + 1); exit }' "${AUTODL_SOURCE_ENV_FILE}")"
  password="$(awk -F= '$1 == "POSTGRES_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' "${AUTODL_SOURCE_ENV_FILE}")"
  database="$(awk -F= '$1 == "POSTGRES_DB" { print substr($0, index($0, "=") + 1); exit }' "${AUTODL_SOURCE_ENV_FILE}")"
  port="$(awk -F= '$1 == "EMBEDDED_POSTGRES_PORT" { print substr($0, index($0, "=") + 1); exit }' "${AUTODL_SOURCE_ENV_FILE}")"
  [[ -n "${user}" && -n "${password}" && -n "${database}" && "${port}" =~ ^[0-9]+$ ]] || err "Local embedded PostgreSQL source identity is incomplete."
  log "Creating a compressed logical bootstrap dump; contents and DSN remain hidden."
  PGPASSWORD="${password}" pg_dump --format=plain --no-owner --no-privileges --host=127.0.0.1 --port="${port}" --username="${user}" --dbname="${database}" | gzip -c >"${dump_file}"
  [[ -s "${dump_file}" ]] || err "Bootstrap dump is empty."
}

bootstrap() {
  local dump_file remote_dump
  if [[ -n "${AUTODL_BOOTSTRAP_DUMP}" ]]; then
    [[ "${AUTODL_BOOTSTRAP_DUMP}" == "${AUTODL_APP_ROOT}"/backups/*.sql.gz ]] || err "AUTODL_BOOTSTRAP_DUMP must be a .sql.gz under AUTODL_APP_ROOT/backups."
    remote_dump="${AUTODL_BOOTSTRAP_DUMP}"
    remote "test -s $(quote "${remote_dump}")"
  else
    dump_file="$(mktemp "${TMPDIR:-/tmp}/ink-autodl-bootstrap.XXXXXX.sql.gz")"
    trap 'rm -f "${dump_file}"' RETURN
    create_dump "${dump_file}"
    remote_dump="${AUTODL_APP_ROOT}/backups/bootstrap-$(date +%Y%m%d_%H%M%S).sql.gz"
    remote "install -d -m 0750 $(quote "${AUTODL_APP_ROOT}/backups")"
    scp_file "${dump_file}" "${remote_dump}"
  fi
  remote "set -e; chgrp $(quote "${AUTODL_SERVICE_USER}") $(quote "${AUTODL_APP_ROOT}/backups") $(quote "${remote_dump}"); chmod 0750 $(quote "${AUTODL_APP_ROOT}/backups"); chmod 0640 $(quote "${remote_dump}")"
  maintenance database-io.js restore-sql-gzip "${remote_dump}"
  maintenance assert-bootstrap.mjs
  maintenance migrate.js
  maintenance migrate.js --check
  start_admin
  verify
  if [[ -n "${dump_file:-}" ]]; then rm -f "${dump_file}"; trap - RETURN; fi
}

verify() {
  remote "set -e; curl -fsS --retry 15 --retry-delay 2 --retry-connrefused --max-time 10 http://127.0.0.1:${AUTODL_ADMIN_PORT}/admin/login >/dev/null; screen -ls | grep -q '[.]${AUTODL_SCREEN_NAME}[[:space:]]'; ss -ltn | awk '{print \$4}' | grep -Eq '(^|:)${AUTODL_ADMIN_PORT}$'"
  [[ -n "${AUTODL_ADMIN_PUBLIC_ORIGIN}" ]] || err "AUTODL_ADMIN_PUBLIC_ORIGIN is required for public verification."
  curl -fsS --retry 12 --retry-delay 3 --retry-connrefused --max-time 15 "${AUTODL_ADMIN_PUBLIC_ORIGIN%/}/admin/login" >/dev/null
  log "Admin local port, screen supervisor, and public mapping passed."
}

deploy() { command_check; setup_host; sync_files; build_release; stop_admin; maintenance migrate.js; maintenance migrate.js --check; start_admin; verify; }

rollback() {
  remote "test -L $(quote "${AUTODL_APP_ROOT}/previous")"
  stop_admin
  remote "set -e; current=\$(readlink -f $(quote "${AUTODL_APP_ROOT}/current")); previous=\$(readlink -f $(quote "${AUTODL_APP_ROOT}/previous")); ln -sfn \"\${current}\" $(quote "${AUTODL_APP_ROOT}/rollback-candidate"); ln -sfn \"\${previous}\" $(quote "${AUTODL_APP_ROOT}/current"); ln -sfn \"\$(readlink -f $(quote "${AUTODL_APP_ROOT}/rollback-candidate"))\" $(quote "${AUTODL_APP_ROOT}/previous"); rm -f $(quote "${AUTODL_APP_ROOT}/rollback-candidate")"
  start_admin; verify
  log "Admin application rolled back; PostgreSQL data and migrations were not reversed."
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
  plan) require_config; command_plan ;;
  sync) require_config; sync_files ;;
  build) command_check; setup_host; sync_files; build_release ;;
  bootstrap) command_check; setup_host; sync_files; build_release; stop_admin; bootstrap ;;
  bootstrap-resume) command_check; [[ -n "${AUTODL_BOOTSTRAP_DUMP}" ]] || err "AUTODL_BOOTSTRAP_DUMP is required."; setup_host; sync_files; remote "cp $(quote "${AUTODL_APP_ROOT}/source/deploy/autodl-ssh/runtime/assert-bootstrap.mjs") $(quote "${AUTODL_APP_ROOT}/current/packages/db/dist/assert-bootstrap.mjs"); chown $(quote "${AUTODL_SERVICE_USER}"):$(quote "${AUTODL_SERVICE_USER}") $(quote "${AUTODL_APP_ROOT}/current/packages/db/dist/assert-bootstrap.mjs")"; stop_admin; bootstrap ;;
  deploy) deploy ;;
  migrate) command_check; stop_admin; maintenance migrate.js; maintenance migrate.js --check; start_admin; verify ;;
  start) require_config; start_admin; verify ;;
  stop) require_config; stop_admin ;;
  status) require_config; remote "screen -ls 2>/dev/null | grep '[.]${AUTODL_SCREEN_NAME}[[:space:]]' || true; if [ -f $(quote "${AUTODL_APP_ROOT}/run/admin.pid") ]; then pid=\$(cat $(quote "${AUTODL_APP_ROOT}/run/admin.pid")); ps -o pid,ppid,user,stat,etimes,cmd -p \"\${pid}\"; fi; ss -ltnp 2>/dev/null | grep -E ':${AUTODL_ADMIN_PORT}[[:space:]]' || true" ;;
  logs) require_config; remote "tail -n 200 $(quote "${AUTODL_APP_ROOT}/logs/admin.log")" ;;
  verify) require_config; verify ;;
  rollback) require_config; rollback ;;
  *) err "Unknown command: ${COMMAND}. Run --help." ;;
esac
