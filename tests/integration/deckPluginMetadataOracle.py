# [Input] Explicit read-only Dream source root and JSON-only original Plugin model/compatibility facts.
# [Output] Actual production model validation and compatibility results, without copied algorithms.
# [Pos] Provider-free source oracle; never imported by application or connected to PostgreSQL.
# [Sync] 2026-09-15: invoke full original Preflight projection and builder snapshot/hash methods on fixed facts.
import json
import os
import sys

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.models.deck_plugin import DeckRuntimePluginLock
from backend.models.workflow_run import WorkflowRun, WorkflowRunTransition
from backend.models.workflow_preflight import WorkflowPreflight

class ReadOnlyResults:
    """Inject fixed read results; do not interpret or execute original SQL."""
    def __init__(self, rows):
        self.rows = iter(rows)

    def execute(self, _statement, _parameters):
        self.current = next(self.rows)
        return self

    def fetchone(self):
        return self.current

    def fetchall(self):
        return self.current


class CapturedResults(ReadOnlyResults):
    """Capture parameter tuples by call position; no SQL interpretation or database."""
    def __init__(self, rows):
        super().__init__(rows)
        self.parameters = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, statement, parameters):
        self.parameters.append(parameters)
        return super().execute(statement, parameters)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

request = json.load(sys.stdin)
if request["action"] == "lock":
    results = []
    for case in request["cases"]:
        try:
            value = DeckRuntimePluginLock.model_validate_json(json.dumps(case)).model_dump(mode="json")
            value.pop("created_at")
            results.append({"accepted": True, "value": value})
        except (ValueError, TypeError):
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "workflow-model":
    models = {"run": WorkflowRun, "transition": WorkflowRunTransition, "preflight": WorkflowPreflight}
    results = []
    for case in request["cases"]:
        try:
            value = models[case["model"]].model_validate_json(json.dumps(case["value"])).model_dump(mode="json")
            for field in ("source_message_time", "created_at", "started_at", "completed_at", "occurred_at", "expires_at"):
                value.pop(field, None)
            results.append({"accepted": True, "value": value})
        except (ValueError, TypeError):
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "preflight-pure":
    from backend.services.workflow.preflight_service import PreflightService
    results = []
    for case in request["cases"]:
        try:
            input_data = json.loads(case["input_json"])
            input_hash = PreflightService._input_hash(input_data)
            fingerprint = PreflightService._request_fingerprint(case["deck_id"], case["binding_revision"], input_hash, case["actor"])
            results.append({"accepted": True, "input_hash": input_hash, "fingerprint": fingerprint})
        except (ValueError, TypeError, UnicodeError):
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "compatibility":
    import asyncio
    from backend.services.deck_plugin.compatibility_service import CompatibilityService, RuntimeContext
    from backend.services.deck_plugin.installation_service import Scope

    results = []
    for case in request["cases"]:
        service = CompatibilityService(ReadOnlyResults([case["release"], case["installation"], case["lock_facts"]]))
        result = asyncio.run(service.check_compatibility(case["input"]["deck_plugin_id"], case["input"]["deck_plugin_version"],
            Scope(scope_type="workspace", scope_id=case["input"]["workspace_id"]), RuntimeContext.model_validate(case["context"])))
        results.append(result.model_dump(mode="json"))
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "preflight-binding-snapshot":
    from backend.services.story_workspace.preflight_builder import StoryWorkspacePreflightServiceBuilder
    from backend.services.workflow.preflight_service import PreflightService
    actor = request["actor"]
    binding_row = request["binding_row"]
    deck = request["deck_row"]
    binding_builder = StoryWorkspacePreflightServiceBuilder(ReadOnlyResults([binding_row]), actor, token_secret=request["secret"])
    binding = binding_builder.resolve_binding(deck["id"], binding_row["binding_revision"])
    snapshot_reads = CapturedResults([binding_row, deck, request["voices"], request["existing_snapshot"], None])
    snapshot_builder = StoryWorkspacePreflightServiceBuilder(snapshot_reads, actor, token_secret=request["secret"])
    snapshot = snapshot_builder.ensure_snapshot(deck["id"], binding["deck_runtime_profile_id"], binding["deck_runtime_snapshot_contract"])
    input_hash = PreflightService._input_hash(json.loads(request["raw_input_json"]))
    fingerprint = PreflightService._request_fingerprint(deck["id"], binding_row["binding_revision"], input_hash, actor["actor_id"])
    json.dump({"binding":binding,"snapshot":snapshot,"snapshot_insert":snapshot_reads.parameters[4] if len(snapshot_reads.parameters) == 5 else None,
        "snapshot_commits":snapshot_reads.commits,"snapshot_rollbacks":snapshot_reads.rollbacks,"input_hash":input_hash,"fingerprint":fingerprint}, sys.stdout, ensure_ascii=True)
elif request["action"] == "preflight-projection":
    from backend.services.workflow.preflight_service import PreflightService
    row = request["row"]
    service = PreflightService(ReadOnlyResults([row]), identity_checker=lambda *_: None,
        binding_resolver=lambda *_: None, manifest_schema_checker=lambda *_: None,
        compatibility_checker=lambda *_: None, capability_policy_checker=lambda *_: None,
        deck_snapshot_owner=lambda *_: None, runtime_materialization_reader=lambda *_: None,
        token_secret=request["secret"], clock=lambda: PreflightService._parse_datetime(request["clock"]))
    if request["mode"] == "read":
        model = service.read_preflight(row["workflow_preflight_id"], actor=row["created_by"])
    else:
        model = service._row_to_model(row, token=service._token_from_row(row) if row["status"] == "passed" else None)
    input_hash = PreflightService._input_hash(json.loads(request["raw_input_json"])) if request["raw_input_json"] is not None else None
    fingerprint = PreflightService._request_fingerprint(row["deck_id"], row["binding_revision"], input_hash or row["input_hash"], row["created_by"])
    json.dump({"preflight":model.model_dump(mode="python"),"input_hash":input_hash,"fingerprint":fingerprint}, sys.stdout,
        ensure_ascii=True, default=PreflightService._iso)
else:
    raise ValueError("Unknown source oracle action")
