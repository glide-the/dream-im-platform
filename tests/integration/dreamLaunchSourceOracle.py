# [Input] Explicit read-only original Dream source, fixed launch commands/results and injected clock.
# [Output] Actual original command/identity or ensure-source result/parameters/commit/rollback.
# [Pos] Provider-free source adapter; no copied business algorithm, SQL interpretation or database access.
# [Sync] 2026-09-15: capture actual application source callsite, including omitted null-Agent fingerprint key.
import asyncio
from datetime import datetime
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.story_workspace.contracts import StoryWorkspaceDreamLaunchCommand
from backend.services.story_workspace.dream_launch_application_service import DreamLaunchApplicationService
from backend.services.story_workspace import dream_launch_infrastructure as original


class CapturedResults:
    """Fixed positional result injection; statements never execute or select fixtures."""
    def __init__(self, rows):
        self.rows = iter(rows)
        self.in_transaction = False
        self.parameters = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, _statement, parameters=()):
        self.parameters.append(parameters)
        self.current = next(self.rows)
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
if request["action"] in {"application-source", "identity"}:
    class CapturedSource(RuntimeError):
        pass

    results = []
    for case in request["cases"]:
        events = []
        captured = {}

        class Workflow:
            async def prepare(self, *_arguments, **_values):
                events.append("prepare")
                return {"binding_revision": 1}

        class Source:
            async def ensure_source(self, **values):
                events.append("source")
                captured.update(values)
                raise CapturedSource()

        def unexpected_dispatch(**_values):
            raise AssertionError("Runtime must never run during source capture")

        value = case["input"]
        command = StoryWorkspaceDreamLaunchCommand.model_validate({"deckId": value["deck_id"], "agentId": value["agent_id"],
                                                                  "goal": value["goal"], "idempotencyKey": value["idempotency_key"]})
        try:
            asyncio.run(DreamLaunchApplicationService(source_repository=Source(), workflow=Workflow(), dispatcher=unexpected_dispatch).launch(
                command, actor_id=case["actor"], workspace_id=value["workspace_id"]))
        except CapturedSource:
            pass
        results.append({"threadId": captured["thread_id"], "messageId": captured["message_id"], "requestFingerprint": captured["request_fingerprint"]}
                       if request["action"] == "identity" else {"arguments": captured, "events": events})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "command":
    results = []
    for case in request["cases"]:
        try:
            command = StoryWorkspaceDreamLaunchCommand.model_validate(case)
            results.append({"accepted": True, "command": command.model_dump(mode="json")})
        except ValueError:
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "ensure":
    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat(request["clock"])

    db = CapturedResults(request["results"])
    try:
        with patch.object(original, "datetime", FixedClock):
            source = asyncio.run(original.DreamLaunchSourceRepository(db).ensure_source(**request["arguments"]))
        result = {"source": {"thread_id": source.thread_id, "message_id": source.message_id,
            "message_time": source.message_time.isoformat(), "request_fingerprint": source.request_fingerprint, "created": source.created}}
    except Exception as error:
        result = {"error": getattr(error, "code", type(error).__name__)}
    parameters = [[str(value) if type(value) is int else value for value in values] for values in db.parameters]
    json.dump({**result, "parameters": parameters, "commits": db.commits, "rollbacks": db.rollbacks}, sys.stdout, ensure_ascii=True)
else:
    raise ValueError("Unknown fixed source action")
