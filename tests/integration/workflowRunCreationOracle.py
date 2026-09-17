# [Input] Explicit read-only Dream source root, fixed context/source facts and original Run requests.
# [Output] Actual original semantic/token/model or atomic-create parameter/commit evidence.
# [Pos] Provider-free source adapter; no copied algorithms, SQL interpretation or database connection.
# [Sync] 2026-09-15: add explicit actual clock sequence and retry-frozen capture; existing actions stay unchanged.
import json
import os
import sys
from contextlib import nullcontext
from unittest.mock import patch
from uuid import UUID

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.models.workflow_run import AuthenticatedActorContext, WorkflowRun
from backend.services.workflow.run_service import WorkflowRunService, WorkflowRunError


class CapturedResults:
    """Inject fixed results by call position; never interpret or execute SQL."""
    def __init__(self, rows):
        self.rows = iter(rows)
        self.in_transaction = False
        self.parameters = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, _statement, parameters=()):
        self.parameters.append(parameters)
        self.current = next(self.rows)
        self.rowcount = 1
        self.in_transaction = True
        return self

    def fetchone(self):
        return self.current

    def commit(self):
        self.commits += 1
        self.in_transaction = False

    def rollback(self):
        self.rollbacks += 1
        self.in_transaction = False


request = json.load(sys.stdin)
if request["action"] == "semantics":
    results = []
    for case in request["cases"]:
        service = WorkflowRunService(None, token_secret=request["secret"])
        context, source = case["context"], case["source"]
        source_time = service._parse_datetime(source["source_message_time"]) if source["source_message_time"] is not None else None
        source_fields = {"source_voice_thread_id": source["source_voice_thread_id"], "source_message_id": source["source_message_id"], "source_message_time": source_time}
        lock_digest = service._lock_digest(context["lock_json"])
        try:
            service._verify_preflight_token_signature(context, case["token"])
            signature_valid = True
        except WorkflowRunError:
            signature_valid = False
        results.append({"frozen_source": service._frozen_source_from_context(context, **source_fields), "lock_digest": lock_digest,
            "fingerprint": service._semantic_fingerprint(context, lock_digest=lock_digest, retry_of_run_id=case["retry_of_run_id"], **source_fields),
            "token_digest": service._token_digest(case["token"]), "signature_valid": signature_valid})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] in {"request-key", "model-key"}:
    results = []
    for case in request["cases"]:
        try:
            value = WorkflowRun.model_validate(case)
            if request["action"] == "request-key":
                db = CapturedResults([])
                db.in_transaction = True
                service = WorkflowRunService(db, token_secret=request["secret"])
                try:
                    service._create_run(preflight_id=value.workflow_preflight_id, preflight_token="pft_fixed", idempotency_key=value.idempotency_key,
                        source_voice_thread_id=None, source_message_id=None, source_message_time=None,
                        actor_context=AuthenticatedActorContext(workspace_id=value.workspace_id, actor_id=value.created_by),
                        retry_of_run_id=None, expected_retry_source=None)
                except RuntimeError as error:
                    if str(error) != "workflow run service requires a clean transaction boundary":
                        raise
            results.append({"accepted": True, "key": value.idempotency_key})
        except (ValueError, TypeError, WorkflowRunError):
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "retry-frozen":
    service = WorkflowRunService(None, token_secret=request["secret"])
    model = service._row_to_run(request["row"])
    json.dump(service._frozen_source_from_run(model), sys.stdout, ensure_ascii=True, default=WorkflowRunService._iso)
elif request["action"] == "create":
    db = CapturedResults(request["rows"])
    clock_values = iter(request["clock_sequence"]) if "clock_sequence" in request else None
    service = WorkflowRunService(db, token_secret=request["secret"], clock=lambda: WorkflowRunService._parse_datetime(next(clock_values) if clock_values is not None else request["clock"]))
    source = request["source"]
    source_time = service._parse_datetime(source["source_message_time"]) if source["source_message_time"] is not None else None
    try:
        identifiers = patch("backend.services.workflow.run_service.uuid.uuid4", side_effect=[UUID(hex=value) for value in request["uuids"]]) if "uuids" in request else nullcontext()
        with identifiers:
            model = service._create_run(preflight_id=request["preflight_id"], preflight_token=request["token"], idempotency_key=request["key"],
                source_voice_thread_id=source["source_voice_thread_id"], source_message_id=source["source_message_id"], source_message_time=source_time,
                actor_context=AuthenticatedActorContext.model_validate(request["actor"]), retry_of_run_id=request["retry_of_run_id"], expected_retry_source=request["expected_retry_source"])
        result = {"accepted": True, "run": model.model_dump(mode="python")}
    except WorkflowRunError as error:
        result = {"accepted": False, "code": error.code}
    result.update({"parameters": db.parameters, "commits": db.commits, "rollbacks": db.rollbacks})
    json.dump(result, sys.stdout, ensure_ascii=True, default=WorkflowRunService._iso)
else:
    raise ValueError("Unknown Run source oracle action")
