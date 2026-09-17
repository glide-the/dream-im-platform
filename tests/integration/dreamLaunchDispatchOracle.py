# [Input] Actual read-only Dream source, fixed positional results, injected clock/UUID and captured turn.
# [Output] Original context/lease/claim/finish results, canonical parameters and commit-before-turn evidence.
# [Pos] Provider-free source oracle; no copied business logic, SQL interpretation, database or Runtime call.
# [Sync] 2026-09-15: capture claim and finish independently at the original production commit boundaries.
from datetime import datetime
import json
import os
import sys
import uuid
from unittest.mock import patch

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.services.story_workspace import dream_launch_infrastructure as original
from backend.story_workspace.contracts import StoryWorkspaceDreamRunContext


class CapturedResults:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.in_transaction = False
        self.parameters = []
        self.events = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, _statement, parameters=()):
        self.parameters.append(parameters)
        self.current = next(self.rows)
        self.in_transaction = True
        self.events.append("execute")
        return self

    def fetchone(self):
        return self.current

    def commit(self):
        self.commits += 1
        self.in_transaction = False
        self.events.append("commit")

    def rollback(self):
        self.rollbacks += 1
        self.in_transaction = False
        self.events.append("rollback")


request = json.load(sys.stdin)
if request["action"] == "context":
    results = []
    for case in request["cases"]:
        try:
            context = StoryWorkspaceDreamRunContext.model_validate(case)
            results.append({"accepted": True, "context": context.model_dump(mode="json")})
        except ValueError:
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "fresh":
    results = [original.DreamLaunchEnvelopeDispatcher._claim_is_fresh(case["metadata"], now=original._parse_time(case["now"])) for case in request["cases"]]
    json.dump(results, sys.stdout)
elif request["action"] == "instruction":
    json.dump({"instruction": original._launch_instruction(request["goal"])}, sys.stdout, ensure_ascii=True)
elif request["action"] in {"dispatch", "finish"}:
    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat(request["clock"])

    db = CapturedResults(request["results"])
    turns = []
    finish_calls = []

    def turn(**values):
        db.events.append("turn")
        turns.append({**{key: value for key, value in values.items() if key not in {"context", "metadata", "parts"}},
                      "context": values["context"].model_dump(mode="json"),
                      "metadata_json": original._canonical_json(values["metadata"]), "parts_json": original._canonical_json(values["parts"])})
        if request.get("turn_error"):
            raise RuntimeError("Injected isolated turn callback error")
        return request.get("turn_accepted", True)

    dispatcher = original.DreamLaunchEnvelopeDispatcher(db, turn_dispatcher=turn)
    if request["action"] == "dispatch":
        # The original callback stays outside the committed claim. The actual
        # finish method is captured separately by the finish action below.
        def capture_finish(message_id, *, claim_id, status):
            finish_calls.append({"message_id": message_id, "claim_id": claim_id, "status": status})
            return True
        dispatcher._finish_claim = capture_finish
    try:
        with patch.object(original, "datetime", FixedClock), patch.object(original.uuid, "uuid4", lambda: uuid.UUID(request["uuid"])):
            if request["action"] == "dispatch":
                source = original.DreamLaunchSource(**{**request["source"], "message_time": original._parse_time(request["source"]["message_time"])})
                accepted = dispatcher(actor_id=request["actor"], goal=request["goal"], source=source,
                                      context=StoryWorkspaceDreamRunContext.model_validate(request["context"]))
            else:
                accepted = dispatcher._finish_claim(request["message_id"], claim_id=request["claim_id"], status=request["status"])
        result = {"accepted": accepted}
    except Exception as error:
        result = {"error": getattr(error, "code", type(error).__name__)}
    json.dump({**result, "turns": turns, "finish_calls": finish_calls, "parameters": db.parameters,
               "commits": db.commits, "rollbacks": db.rollbacks, "events": db.events}, sys.stdout, ensure_ascii=True)
else:
    raise ValueError("Unknown fixed dispatch source action")
