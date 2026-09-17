# [Input] Actual Dream current-user picture helpers, fixed rows and captured connections.
# [Output] Original list/range/full projections, SQL parameters, ordering clauses and close behavior.
# [Pos] Source-only oracle; it opens no pool, interprets no SQL and touches no business database.
# [Sync] 2026-09-15: freeze the three legacy reads before Dream consumer replacement.
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
import database as original


class CapturedConnection:
    def __init__(self, rows, one=None):
        self.rows = rows
        self.one = one
        self.statements = []
        self.parameters = []
        self.closes = 0

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(str(statement).split()))
        self.parameters.append(list(parameters))
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.one

    def close(self):
        self.closes += 1


request = json.load(sys.stdin)
recent = CapturedConnection(request["recent_rows"])
range_read = CapturedConnection(request["range_rows"])
full = CapturedConnection([], request["full_row"])
missing = CapturedConnection([], None)
connections = iter([recent, range_read, full, missing])
with patch.object(original, "get_db", side_effect=lambda: next(connections)):
    recent_result = original.get_daily_pictures(request["actor"], request["limit"])
    range_result = original.get_daily_pictures_range(
        request["actor"], request["start_date"], request["end_date"], request["limit"]
    )
    full_result = original.get_daily_picture_full(request["actor"], request["full_date"])
    missing_result = original.get_daily_picture_full(request["actor"], request["missing_date"])


def capture(connection):
    return {
        "statements": connection.statements,
        "parameters": connection.parameters,
        "closes": connection.closes,
    }


print(json.dumps({
    "recent_result": recent_result,
    "range_result": range_result,
    "full_result": full_result,
    "missing_result": missing_result,
    "recent": capture(recent),
    "range": capture(range_read),
    "full": capture(full),
    "missing": capture(missing),
}, ensure_ascii=True, allow_nan=False))
