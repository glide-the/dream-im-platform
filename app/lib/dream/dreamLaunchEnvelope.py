# [Input] Fixed raw launch metadata, authoritative context/clock and narrow overlay facts.
# [Output] Original canonical JSON preserving integer/float categories and microsecond lease comparison.
# [Pos] Pure codec only; no database, source import, network or application state-machine execution.
# [Sync] 2026-09-15: preserve unknown fields, naive/offset timestamps and strict finite canonical output.
from datetime import datetime, timezone, timedelta
import json
import sys


def object_metadata(raw):
    try:
        value = json.loads(str(raw or "{}"))
    except (TypeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def parse_time(raw):
    value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def string_or_none(value):
    return value if isinstance(value, str) else None


request = json.load(sys.stdin)
metadata = object_metadata(request["metadata_json"])
if request["action"] == "inspect":
    fresh = False
    if metadata.get("dispatchStatus") == "dispatching" and isinstance(metadata.get("dispatchClaimedAt"), str):
        try:
            fresh = parse_time(request["now"]) - parse_time(metadata["dispatchClaimedAt"]) < timedelta(seconds=request["ttl_seconds"])
        except (TypeError, ValueError):
            pass
    result = {"kind": string_or_none(metadata.get("kind")), "actor_id": string_or_none(metadata.get("actorId")),
              "workspace_id": string_or_none(metadata.get("workspaceId")), "deck_id": string_or_none(metadata.get("deckId")),
              "agent_id": string_or_none(metadata.get("agentId")), "agent_valid": metadata.get("agentId") is None or isinstance(metadata.get("agentId"), str),
              "goal": string_or_none(metadata.get("goal")), "idempotency_key": string_or_none(metadata.get("idempotencyKey")),
              "request_fingerprint": string_or_none(metadata.get("requestFingerprint")),
              "workflow_run_id": string_or_none(metadata.get("workflowRunId")),
              "run_valid": metadata.get("workflowRunId") is None or isinstance(metadata.get("workflowRunId"), str),
              "dispatch_status": string_or_none(metadata.get("dispatchStatus")), "claim_id": string_or_none(metadata.get("dispatchClaimId")), "claim_fresh": fresh}
elif request["action"] == "claim-overlay":
    metadata.update({"workflowRunId": request["context"]["workflow_run_id"], "threadId": request["context"]["thread_id"],
                     "dreamContext": request["context"], "projectStorySlug": request["project_slug"],
                     "dispatchStatus": "dispatching", "dispatchClaimId": request["claim_id"], "dispatchClaimedAt": request["now"]})
    runtime = dict(metadata)
    runtime["dispatchStatus"] = "dispatched"
    runtime.pop("dispatchClaimId", None)
    runtime.pop("dispatchClaimedAt", None)
    result = {"metadata_json": canonical(metadata), "runtime_metadata_json": canonical(runtime),
              "parts_json": canonical([{"type": "text", "text": request["instruction_text"]}])}
elif request["action"] == "finish-overlay":
    metadata["dispatchStatus"] = "dispatched" if request["accepted"] else "pending"
    metadata.pop("dispatchClaimId", None)
    metadata.pop("dispatchClaimedAt", None)
    result = {"metadata_json": canonical(metadata)}
else:
    raise ValueError("Unknown fixed launch envelope action")
json.dump(result, sys.stdout, ensure_ascii=True, allow_nan=False)
