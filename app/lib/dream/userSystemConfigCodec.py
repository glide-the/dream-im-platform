# [Input] Fixed read/merge action, raw stored JSON and closed normalized patch from Admin service.
# [Output] Python JSON config preserving integer/float/negative-zero/Unicode and unknown stored keys.
# [Pos] Pure server codec candidate; no imports of Dream, database, environment, filesystem or network.
# [Sync] 2026-09-15: original json.loads/update/dumps behavior on finite objects; invalid data fails closed.
import json
import sys

def invalid(_value):
    raise ValueError("invalid config")

def execute(request):
    if not isinstance(request, dict) or request.get("action") not in ("read", "merge"):
        raise ValueError("invalid config")
    expected = {"action", "stored_json"} | ({"patch"} if request["action"] == "merge" else set())
    if set(request) != expected or (request["stored_json"] is not None and not isinstance(request["stored_json"], str)):
        raise ValueError("invalid config")
    value = json.loads(request["stored_json"], parse_constant=invalid) if request["stored_json"] else {}
    if not isinstance(value, dict):
        raise ValueError("invalid config")
    if request["action"] == "merge":
        patch = request["patch"]
        keys = {"model", "provider", "system_prompt", "workspace_enabled", "sandbox_network_mode", "sandbox_network_allowed_domains", "sandbox_fs_allowed_write_paths", "im_full_access_enabled", "theme", "env_vars"}
        if not isinstance(patch, dict) or not set(patch).issubset(keys):
            raise ValueError("invalid config")
        value.update(patch)
    return {"config_json": json.dumps(value, allow_nan=False)}

if __name__ == "__main__":
    try:
        print(json.dumps(execute(json.load(sys.stdin, parse_constant=invalid)), allow_nan=False))
    except (ValueError, TypeError, OverflowError, RecursionError):
        print("System configuration codec failed", file=sys.stderr)
        sys.exit(1)
