# [Input] Actual Dream Reflections database/Agent helpers with fixed rows, results, clock and captured connection.
# [Output] Original normalization, report projection and independent write transaction evidence.
# [Pos] Source-only Reflections oracle; SQL is captured and no pool, filesystem, provider or business database is used.
# [Sync] 2026-09-15: cover task/result/event/report semantics before Admin provider registration.
import json
import os
import sys
import uuid
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
import database as original_database
import reflections_agent as original_agent


class CapturedConnection:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.parameters = []
        self.statements = []
        self.commits = 0
        self.closes = 0

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(str(statement).split()))
        self.parameters.append([str(value) if isinstance(value, int) and abs(value) > 9007199254740991 else value for value in parameters])
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def commit(self):
        self.commits += 1

    def close(self):
        self.closes += 1


def database_call(case):
    db = CapturedConnection(case.get("rows"))
    with patch.object(original_database, "get_db", return_value=db):
        action = case["action"]
        if action == "create":
            result = original_database.create_reflection_task(int(case["user_id"]), case["sections"], case["input_snapshot"], task_id=case["task_id"])
        elif action == "status":
            result = original_database.update_reflection_task_status(case["task_id"], case["status"], error_summary=case.get("error_summary"), completed_at=case.get("completed_at"))
        elif action == "replace":
            with patch.object(uuid, "uuid4", side_effect=[uuid.UUID(value) for value in case["result_ids"]]):
                result = original_database.replace_reflection_section_results(case["task_id"], int(case["user_id"]), case["section"], case["results"])
        elif action == "event":
            result = original_database.append_reflection_task_event(case["task_id"], case["event_type"], case["payload"], event_id=case["event_id"], sequence=case["sequence"], created_at=case["created_at"])
        elif action == "report-save":
            result = original_database.save_analysis_report(int(case["user_id"]), case["report_type"], json.loads(case["report_data_json"]), case.get("all_notes_text"))
        elif action == "report-list":
            result = original_database.get_analysis_reports(int(case["user_id"]), case.get("limit", 10))
        else:
            raise AssertionError("unknown fixed database action")
    return {"result": result, "parameters": db.parameters, "statements": db.statements, "commits": db.commits, "closes": db.closes}


def agent_report(case):
    calls = []
    with patch.object(original_agent.database, "list_reflection_results", return_value=case["persisted"]), patch.object(
        original_agent.database, "save_analysis_report", side_effect=lambda *args: calls.append([str(args[0]), *args[1:]])
    ):
        original_agent.ReflectionsTaskEngine._persist_analysis_report(case["context"], case["completed_sections"])
    return calls


request = json.load(sys.stdin)
with patch.object(original_database, "_open_runtime_pool", side_effect=AssertionError("No source pool permitted")):
    output = {
        "validated": original_agent.ReflectionsTaskEngine._validate_results(request["validation"]["results"], request["validation"]["section"], request["validation"]["sessions"]),
        "report_calls": agent_report(request["report"]),
        "database_calls": [database_call(case) for case in request["database_calls"]],
        "decoded": {
            "task": original_database._reflection_task_from_row(request["decode"]["task"]),
            "result": original_database._reflection_result_from_row(request["decode"]["result"]),
            "event": original_database._reflection_event_from_row(request["decode"]["event"]),
        },
    }
print(json.dumps(output, ensure_ascii=True, allow_nan=False))
