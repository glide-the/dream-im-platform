# [Input] Explicit original Dream source, fixed SystemConfig rows and closed normalized patches.
# [Output] Actual original get/save result JSON, every positional parameter and commit/close/error.
# [Pos] Test-only source adapter; no SQL interpretation, PostgreSQL, provider or runtime.
# [Sync] 2026-09-15: compare source JSON precision, absence, invalid objects and failed write.
import json
import os
import sys
from unittest.mock import patch
sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend import database as original

class CapturedResults:
    def __init__(self, case, write=False):
        self.row = {"system_config_json": case["raw"]} if case["exists"] else None
        self.write = write
        self.fail_write = case.get("fail_write", False)
        self.parameters = []
        self.commits = 0
        self.closes = 0
    def execute(self, _statement, parameters=()):
        self.parameters.append([str(value) if type(value) is int else value for value in parameters])
        if self.write and self.fail_write and len(self.parameters) == 2:
            raise RuntimeError("selected source write failure")
        return self
    def fetchone(self):
        return self.row
    def commit(self):
        self.commits += 1
    def close(self):
        self.closes += 1

results = []
for case in json.load(sys.stdin)["cases"]:
    read_db = CapturedResults(case)
    save_db = CapturedResults(case, write=True)
    result = None
    read_error = None
    save_error = None
    with patch.object(original, "get_db", return_value=read_db):
        try:
            result = json.dumps(original.get_system_config(int(case["actor"])))
        except (ValueError, TypeError, AttributeError, RuntimeError) as exc:
            read_error = type(exc).__name__
    with patch.object(original, "get_db", return_value=save_db):
        try:
            original.save_system_config(int(case["actor"]), case["patch"])
        except (ValueError, TypeError, AttributeError, RuntimeError) as exc:
            save_error = type(exc).__name__
    results.append({"read_config_json": result, "read_error": read_error, "save_error": save_error,
                    "read_parameters": read_db.parameters, "save_parameters": save_db.parameters,
                    "read_commits": read_db.commits, "save_commits": save_db.commits,
                    "read_closes": read_db.closes, "save_closes": save_db.closes})
print(json.dumps(results, allow_nan=False))
