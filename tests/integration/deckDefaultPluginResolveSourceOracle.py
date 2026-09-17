# [Input] Actual Dream default-plugin source with fixed installation lists and captured verifier seams.
# [Output] Legacy newest-first selection, four-field evidence, failure states and connection close behavior.
# [Pos] Source-only oracle; it opens no pool, filesystem artifact or Claude CLI process.
# [Sync] 2026-09-15: freeze old resolution semantics before Dream consumes Registry104 metadata.
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from services.deck import defaults as original
from services.claude_plugin.install_service import PluginInstallService


class CapturedConnection:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.statements = []
        self.closes = 0

    def execute(self, statement, parameters=()):
        self.statements.append(" ".join(str(statement).split()))
        return self

    def fetchall(self):
        return self.rows

    def close(self):
        self.closes += 1


class Row(dict):
    def keys(self):
        return super().keys()


request = json.load(sys.stdin)
ordered_connection = CapturedConnection([Row(item) for item in request["ordered_rows"]])
ordered = PluginInstallService(ordered_connection).list_installations()


def run_case(items, artifact=True, cli=True):
    connection = CapturedConnection()
    calls = {"listed": 0, "artifact": [], "cli": []}

    class Service:
        def __init__(self, db):
            assert db is connection

        def list_installations(self):
            calls["listed"] += 1
            return items

        def verify_installation_artifact(self, installation):
            calls["artifact"].append(installation["id"])
            return artifact

        def check_cli_compatibility(self, installation):
            calls["cli"].append(installation["id"])
            return cli

    try:
        with patch.object(original.config, "DEFAULT_DECK_CLAUDE_PLUGIN_PACKAGE_NAME", request["package"]), patch.object(
            original.config, "DEFAULT_DECK_CLAUDE_PLUGIN_VERSION", request["version"]
        ), patch.object(original.database, "get_db", return_value=connection), patch.object(
            original, "PluginInstallService", Service
        ):
            result = original.resolve_default_deck_plugin_ref()
        return {"status": "resolved", "result": result, "calls": calls, "closes": connection.closes}
    except original.DefaultDeckPluginUnavailable:
        return {"status": "unavailable", "calls": calls, "closes": connection.closes}


items = request["items"]
print(json.dumps({
    "ordered": ordered,
    "ordering_sql": ordered_connection.statements,
    "success": run_case(items),
    "absent": run_case([item for item in items if item["package_name"] != request["package"]]),
    "artifact_failure": run_case(items, artifact=False),
    "cli_failure": run_case(items, cli=False),
}, ensure_ascii=True, allow_nan=False))
