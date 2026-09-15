# [Input] Explicit original Dream source and fixed positional default Workspace results/UUID.
# [Output] Actual original helper result, exact actor parameters and commit/rollback counts.
# [Pos] Provider-free test-only source adapter; no SQL interpretation or database connection.
# [Sync] 2026-09-15: compare legacy/fresh IDs and original creation/error transaction behavior.
import json
import os
import sys
from unittest.mock import patch
from uuid import UUID
sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.services.story_workspace import agent_integration as original
class CapturedResults:
    def __init__(self, existing, fail_insert):
        self.rows = iter([(existing,) if existing is not None else None, None])
        self.fail_insert = fail_insert
        self.parameters = []
        self.commits = 0
        self.rollbacks = 0
    def execute(self, _statement, parameters=()):
        self.parameters.append(parameters)
        if self.fail_insert and len(self.parameters) == 2:
            raise RuntimeError("selected source insert failure")
        self.current = next(self.rows)
        return self
    def fetchone(self):
        return self.current
    def commit(self):
        self.commits += 1
    def rollback(self):
        self.rollbacks += 1
request = json.load(sys.stdin)
results = []
for case in request["cases"]:
    db = CapturedResults(case["existing"], case.get("fail_insert", False))
    result = None
    error = None
    with patch.object(original, "uuid4", return_value=UUID(case["uuid"])):
        try:
            result = original.get_or_create_default_workspace(db, int(case["actor"]))
        except original.AgentIntegrationError as exc:
            error = str(exc)
    parameters = []
    for index, values in enumerate(db.parameters):
        value = list(values)
        value[0 if index == 0 else 2] = str(value[0 if index == 0 else 2])
        parameters.append(value)
    results.append({"result": result, "error": error, "parameters": parameters,
                    "commits": db.commits, "rollbacks": db.rollbacks})
print(json.dumps(results, ensure_ascii=False))
