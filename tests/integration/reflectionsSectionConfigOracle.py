# [Input] Actual read-only Dream database functions and fixed owner/section/row/prompt parameters.
# [Output] Original result JSON text, exact decimal owner/parameter types, commit/close and safe exception.
# [Pos] Source-only Reflections get/save/delete adapter; SQL is captured, never interpreted or executed.
# [Sync] 2026-09-15: preserve legacy object decoding, original serializer bytes and independent write COMMIT.
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
import database as original


class CapturedConnection:
    def __init__(self, case):
        self.case = case
        self.parameters = []
        self.commits = 0
        self.closes = 0
        self.rowcount = case.get("rowcount", 0)

    def execute(self, _statement, parameters=()):
        self.parameters.append({"actor_decimal": str(parameters[0]), "actor_type": type(parameters[0]).__name__, "values": list(parameters[1:])})
        if self.case.get("execute_error"):
            raise RuntimeError("Captured source query failure")
        return self

    def fetchone(self):
        return self.case.get("row")

    def commit(self):
        self.commits += 1

    def close(self):
        self.closes += 1


def capture(case):
    db = CapturedConnection(case)
    result_json = None
    error = None
    with patch.object(original, "get_db", return_value=db):
        try:
            actor, section = int(case["actor"]), case["section"]
            if case["action"] == "get":
                result = original.get_reflections_section_config(actor, section)
            elif case["action"] == "save":
                result = original.save_reflections_section_config(actor, section, json.loads(case["prompt_files_json"]))
            elif case["action"] == "delete":
                result = original.delete_reflections_section_config(actor, section)
            else:
                raise AssertionError("Unknown fixed source action")
            result_json = json.dumps(result, ensure_ascii=False)
        except Exception as exc:
            error = type(exc).__name__
    return {"result_json": result_json, "error": error, "parameters": db.parameters, "commits": db.commits, "closes": db.closes}


request = json.load(sys.stdin)
with patch.object(original, "_open_runtime_pool", side_effect=AssertionError("No source pool permitted")):
    results = [capture(case) for case in request["cases"]]
print(json.dumps(results, ensure_ascii=True, allow_nan=False))
