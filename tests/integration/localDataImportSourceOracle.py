# [Input] Actual Dream import/first-login helpers, fixed normalized data and a captured connection.
# [Output] Original SQL parameters, commits, closes and owner-transfer/timestamp behavior for review.
# [Pos] Source-only oracle; it opens no pool, interprets no SQL and touches no business database.
# [Sync] 2026-09-15: freeze the legacy aggregate and update-or-insert behavior before Dream consumer replacement.
import builtins
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
import database as original


def safe_parameter(value):
    if type(value) is int and abs(value) > 9007199254740991:
        return str(value)
    return value


class CapturedConnection:
    def __init__(self, existing=False):
        self.existing = existing
        self.statements = []
        self.parameters = []
        self.commits = 0
        self.closes = 0

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(str(statement).split()))
        self.parameters.append([safe_parameter(value) for value in parameters])
        return self

    def fetchone(self):
        return {"user_id": 1} if self.existing else None

    def commit(self):
        self.commits += 1

    def close(self):
        self.closes += 1


request = json.load(sys.stdin)
aggregate = CapturedConnection()
with patch.object(original, "get_db", return_value=aggregate), patch.object(builtins, "print"):
    source = request["aggregate"]
    sessions = [{"id": item["id"], "name": item["name"], "editor_state": json.loads(item["editor_state_json"])} for item in source["sessions"]]
    preferences = {
        "voice_configs": json.loads(source["preferences"]["voice_configs_json"]),
        "meta_prompt": source["preferences"]["meta_prompt"],
        "state_config": json.loads(source["preferences"]["state_config_json"]),
        "selected_state": source["preferences"]["selected_state"],
    }
    reports = [{
        "type": item["type"], "data": json.loads(item["data_json"]),
        "allNotes": item["allNotes"], "timestamp": item["timestamp"],
    } for item in source["reports"]]
    original.import_user_data(
        int(source["actor"]), sessions, source["pictures"], preferences, reports,
    )

first_login = []
for case in request["first_login"]:
    connection = CapturedConnection(case["existing"])
    with patch.object(original, "get_db", return_value=connection):
        original.set_first_login_completed(int(case["actor"]))
    first_login.append({
        "existing": case["existing"], "statements": connection.statements,
        "parameters": connection.parameters, "commits": connection.commits, "closes": connection.closes,
    })

print(json.dumps({
    "aggregate": {"statements": aggregate.statements, "parameters": aggregate.parameters, "commits": aggregate.commits, "closes": aggregate.closes},
    "first_login": first_login,
}, ensure_ascii=True, allow_nan=False))
