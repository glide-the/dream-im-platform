#!/usr/bin/env bash
# [Input] Remote SSH env projector plus a disposable complete Admin source env.
# [Output] Provider-free assertions for issuer/resource/service-registration projection and fail-closed validation.
# [Pos] Deterministic Remote SSH runtime configuration contract test.
# [Sync] 2026-09-16: cover the unified auth/data deployment projection without touching a database.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/admin-remote-env.XXXXXX")"
trap 'rm -rf "${TEMP_ROOT}"' EXIT

SOURCE_ENV="${TEMP_ROOT}/source.env"
OUTPUT_ENV="${TEMP_ROOT}/projected.env"
SERVICE_CLIENTS='[{"id":"ink-dream-service","secret":"dream-service-secret-at-least-thirty-two-bytes","origin":"https://dream.example.test","oauthClientId":"ink-dream-browser","redirectUri":"https://dream.example.test/auth/callback","backgroundScopes":["capabilities:read"]}]'

cat >"${SOURCE_ENV}" <<'EOF'
POSTGRES_USER=ink_test
POSTGRES_PASSWORD=test-password
POSTGRES_DB=ink-memory
ADMIN_SESSION_SECRET=test-admin-session
ADMIN_BOOTSTRAP_TOKEN=test-admin-bootstrap
GATEWAY_API_KEY_PEPPER=test-gateway-pepper
AI_CREDENTIAL_ENCRYPTION_KEY=test-encryption-key
PRODUCT_API_JWT_SECRET=test-product-secret
BETTER_AUTH_SECRET=better-auth-secret-at-least-thirty-two-bytes
AUTH_DATABASE_URL=postgres://ink_auth:test@127.0.0.1:5432/ink-memory
ADMIN_CONTROL_DATABASE_URL=postgres://ink_admin_control:test@127.0.0.1:5432/ink-memory
DREAM_DATA_DATABASE_URL=postgres://ink_dream_data:test@127.0.0.1:5432/ink-memory
GOOGLE_CLIENT_ID=test-google-client
GOOGLE_CLIENT_SECRET=test-google-secret
AUTH_TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
AUTH_DEVICE_CLIENT_ID=ink-dream-device
DREAM_GATEWAY_CLIENT_BINDINGS=[{"service_client_id":"ink-dream-service","gateway_client_id":"test-gateway","oauth_client_ids":["ink-dream-browser"]}]
INK_WORKFLOW_TOKEN_SECRET=workflow-secret-at-least-thirty-two-bytes
DREAM_WORKSPACE_PLUGIN_POLICY_JSON={"version":1}
DREAM_RUNTIME_ACTIVATION_POLICY_JSON={"version":1}
DREAM_DECK_POLICY_JSON={"version":1}
BETTER_AUTH_URL=https://stale.example/api/auth
AUTH_TRUSTED_ORIGINS=https://stale.example
DREAM_API_RESOURCE=https://stale.example/api
DREAM_DATA_SERVICE_CLIENTS=[]
DREAM_REFLECTIONS_WORKSPACE_ROOT=/tmp/stale-reflections
EOF

ADMIN_ENV_SOURCE="${SOURCE_ENV}" \
ADMIN_REMOTE_ENV_FILE="${OUTPUT_ENV}" \
ADMIN_PUBLIC_ORIGIN=https://admin.example.test \
DREAM_PUBLIC_ORIGIN=https://dream.example.test \
REMOTE_DREAM_DATA_SERVICE_CLIENTS="${SERVICE_CLIENTS}" \
  "${SCRIPT_DIR}/prepare-env.sh"

grep -Fx 'BETTER_AUTH_URL=https://admin.example.test/api/auth' "${OUTPUT_ENV}"
grep -Fx 'AUTH_TRUSTED_ORIGINS=https://admin.example.test,https://dream.example.test' "${OUTPUT_ENV}"
grep -Fx 'DREAM_API_RESOURCE=https://dream.example.test/api' "${OUTPUT_ENV}"
grep -Fx "DREAM_DATA_SERVICE_CLIENTS=${SERVICE_CLIENTS}" "${OUTPUT_ENV}"
grep -Fx 'DREAM_REFLECTIONS_WORKSPACE_ROOT=/artifacts/reflections' "${OUTPUT_ENV}"
[[ "$(stat -f '%Lp' "${OUTPUT_ENV}" 2>/dev/null || stat -c '%a' "${OUTPUT_ENV}")" == "600" ]]

if ADMIN_ENV_SOURCE="${SOURCE_ENV}" ADMIN_REMOTE_ENV_FILE="${OUTPUT_ENV}" \
  ADMIN_PUBLIC_ORIGIN=https://admin.example.test DREAM_PUBLIC_ORIGIN=https://other.example.test \
  REMOTE_DREAM_DATA_SERVICE_CLIENTS="${SERVICE_CLIENTS}" "${SCRIPT_DIR}/prepare-env.sh" >/dev/null 2>&1; then
  printf 'mismatched Dream service registration was accepted\n' >&2
  exit 1
fi

printf '[remote-env-test] unified auth/data projection passed.\n'
