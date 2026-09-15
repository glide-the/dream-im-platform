# [Input] Read-only Dream source, fixed positional results and explicit clock/UUID/connection DI.
# [Output] Actual whole failure recorder/transition parameters and ordered commit/rollback/close.
# [Pos] Provider-free source adapter; no copied state machine, SQL interpretation or database call.
# [Sync] 2026-09-15: prove Run failure commits before its separate envelope metadata transaction.
import asyncio
from datetime import datetime
import json
import os
import sys
import uuid
from unittest.mock import patch

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.services.story_workspace import dream_launch_infrastructure as original
import database as runtime_database


class CapturedResults:
    def __init__(self, rows, fault_at):
        self.rows = iter(rows)
        self.fault_at = fault_at
        self.in_transaction = False
        self.parameters = []
        self.events = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0

    def execute(self, _statement, parameters=()):
        self.parameters.append(parameters)
        self.events.append("execute")
        self.in_transaction = True
        if len(self.parameters) == self.fault_at:
            raise RuntimeError("Injected fixed-position verification fault")
        self.current = next(self.rows)
        self.rowcount = 1
        return self

    def fetchone(self):
        return self.current

    def commit(self):
        self.events.append("commit")
        self.commits += 1
        self.in_transaction = False

    def rollback(self):
        self.events.append("rollback")
        self.rollbacks += 1
        self.in_transaction = False

    def close(self):
        self.events.append("close")
        self.closed += 1


request = json.load(sys.stdin)
db = CapturedResults(request["rows"], request.get("fault_at"))
service_class = original.WorkflowRunService
service_module = sys.modules[service_class.__module__]


def actual_service(*args, **values):
    return service_class(*args, **values, clock=lambda: datetime.fromisoformat(request["clock"]))


with patch.object(runtime_database, "get_db", lambda: db), \
     patch.object(runtime_database, "_open_runtime_pool", side_effect=AssertionError("Database pool must never open")), \
     patch.object(original, "WorkflowRunService", actual_service), \
     patch.object(service_module.uuid, "uuid4", lambda: uuid.UUID(request["uuid"])):
    asyncio.run(original.DreamLaunchFailureRecorder(request["secret"]).record(**request["arguments"]))
json.dump({"parameters": db.parameters, "events": db.events, "commits": db.commits,
           "rollbacks": db.rollbacks, "closed": db.closed}, sys.stdout, ensure_ascii=True)
