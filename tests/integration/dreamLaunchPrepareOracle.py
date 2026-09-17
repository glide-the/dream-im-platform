# [Input] Actual read-only Dream prepare adapter, fixed positional rows and captured named collaborators.
# [Output] Whole prepare/replay/Agent-scope result, parameters, rollback/catalog/binding order and safe errors.
# [Pos] Source-only test adapter; no SQL interpretation, pool, Gateway, filesystem or actual provisioning.
# [Sync] 2026-09-15: preserve camelCase wire validation and original PermissionError scope capture.
import asyncio
from dataclasses import asdict
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.services.story_workspace import dream_launch_infrastructure as original
import database as runtime_database


class CapturedResults:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.parameters = []
        self.events = []
        self.in_transaction = False
        self.rollbacks = 0

    def execute(self, _statement, parameters=()):
        self.parameters.append(parameters)
        self.events.append("execute")
        self.in_transaction = True
        self.current = next(self.rows)
        return self

    def fetchone(self):
        return self.current

    def rollback(self):
        self.rollbacks += 1
        self.events.append("rollback")
        self.in_transaction = False


class CapturedProvisioner:
    def __init__(self, db, case):
        self.db = db
        self.case = case
        self.scope_arguments = []
        self.frozen_arguments = []
        self.binding_arguments = []

    def require_agent_scope(self, deck_id, agent_id):
        return original.DreamRuntimeProvisioningService.require_agent_scope(self, deck_id, agent_id)

    def _require_scope(self, deck_id, actor_id, workspace_id):
        self.db.events.append("current_scope")
        self.scope_arguments.append([deck_id, actor_id, workspace_id])
        if self.case.get("scope_error"):
            raise PermissionError("Captured original current-scope rejection")

    def ensure_frozen_runtime_evidence(self, lock_id):
        self.db.events.append("frozen_evidence")
        self.frozen_arguments.append(lock_id)
        if self.case.get("frozen_error"):
            raise original.DreamLaunchApplicationError("RUNTIME_PLUGIN_NOT_READY", 503)

    async def require_binding(self, **values):
        self.db.events.append("binding")
        self.binding_arguments.append(values)
        return original.DreamLaunchBinding(**self.case["binding"])


async def capture(case):
    db = CapturedResults(case["rows"])
    provisioner = CapturedProvisioner(db, case)
    catalog_arguments = []

    def catalog(actor, model):
        db.events.append("catalog")
        catalog_arguments.append([actor, model])
        if db.in_transaction:
            raise AssertionError("Read transaction must be rolled back before catalog")
        if case.get("model_error"):
            raise original.GatewayInferenceError("MODEL_SCOPE_DENIED", 403)
        return "captured-eligible-model"

    adapter = object.__new__(original.DreamLaunchWorkflowOperationsAdapter)
    adapter.db = db
    adapter._provisioner = provisioner
    adapter._platform_model_resolver = catalog
    adapter._existing_run = None
    adapter._actor_context = None
    result = None
    error = None
    try:
        values = case["command"]
        command = original.StoryWorkspaceDreamLaunchCommand.model_validate({
            "deckId": values["deck_id"], "agentId": values["agent_id"],
            "goal": values["goal"], "idempotencyKey": values["idempotency_key"],
        })
        binding = await adapter.prepare(command, actor_id=case["actor"], workspace_id=case["workspace"])
        result = asdict(binding)
    except Exception as exc:
        error = {"class": type(exc).__name__, "code": getattr(exc, "code", None), "status": getattr(exc, "status_code", None)}
    return {"result": result, "error": error, "parameters": db.parameters, "events": db.events,
            "rollbacks": db.rollbacks, "in_transaction": db.in_transaction, "catalog_arguments": catalog_arguments,
            "scope_arguments": provisioner.scope_arguments, "frozen_arguments": provisioner.frozen_arguments,
            "binding_arguments": provisioner.binding_arguments, "existing_run": adapter._existing_run,
            "actor_context": None if adapter._actor_context is None else {
                "actor_id": adapter._actor_context.actor_id, "workspace_id": adapter._actor_context.workspace_id}}


async def main():
    request = json.load(sys.stdin)
    with patch.object(runtime_database, "_open_runtime_pool", side_effect=AssertionError("No source pool permitted")):
        results = [await capture(case) for case in request["cases"]]
    print(json.dumps(results, ensure_ascii=False, allow_nan=False))


asyncio.run(main())
