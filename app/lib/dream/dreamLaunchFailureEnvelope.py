# [Input] Fixed launch metadata text and the original truthy terminal error string.
# [Output] Original numeric-preserving canonical failed envelope with claim fields removed.
# [Pos] Registered77 fixed pure stdlib codec; no database, actor, Runtime or request file selector.
# [Sync] 2026-09-15: preserve independent overlay semantics at fixed server binding/Next tracing.
import json
import sys

request = json.load(sys.stdin)
if not isinstance(request, dict) or set(request) != {"metadata", "error_code"}:
    raise ValueError("Invalid fixed failure envelope input")
if request["metadata"] is not None and not isinstance(request["metadata"], str):
    raise ValueError("Invalid failure metadata text")
if not isinstance(request["error_code"], str) or not request["error_code"]:
    raise ValueError("Invalid terminal error string")
try:
    metadata = json.loads(request["metadata"] or "{}")
except (ValueError, TypeError):
    metadata = {}
if not isinstance(metadata, dict):
    metadata = {}
metadata["dispatchStatus"] = "failed"
metadata["dispatchErrorCode"] = request["error_code"]
metadata.pop("dispatchClaimId", None)
metadata.pop("dispatchClaimedAt", None)
json.dump({"metadata_json": json.dumps(metadata, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))}, sys.stdout, ensure_ascii=True)
