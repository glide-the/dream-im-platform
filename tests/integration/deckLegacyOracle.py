# [Input] Explicit harness Dream source root and JSON-only model/snapshot fixtures.
# [Output] Original Dream production model/hash/diff results, no copied business algorithms.
# [Pos] Cross-repository read-only provider-free oracle; never imported by Admin production.
# [Sync] 2026-09-14: exercise actual DeckPluginManifestV1 and content-version functions.
import json
import os
import sys

sys.path.insert(0, os.environ["INK_DREAM_SOURCE"])
sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from backend.models.deck_plugin import DeckPluginManifestV1
from backend.services.deck.content_versioning import DeckContentVersionService, _canonical_json, _content_hash

request = json.load(sys.stdin)
if request["action"] == "manifest":
    results = []
    for case in request["cases"]:
        try:
            results.append({"accepted": True, "value": DeckPluginManifestV1.model_validate(case).model_dump(mode="json")})
        except (ValueError, TypeError):
            results.append({"accepted": False})
    json.dump(results, sys.stdout, ensure_ascii=True)
elif request["action"] == "canonical":
    json.dump([{"canonical_json": _canonical_json(json.loads(raw)), "content_hash": _content_hash(json.loads(raw))} for raw in request["cases"]], sys.stdout, ensure_ascii=True)
elif request["action"] == "snapshot":
    class Rows:
        def __init__(self, rows):
            self.rows = rows
        def fetchall(self):
            return self.rows
        def fetchone(self):
            return self.rows[0] if self.rows else None
    class SourceFacts:
        def execute(self, query, params):
            if "FROM voices" in query:
                return Rows(request["voices"])
            if "FROM deck_claude_plugin_refs" in query:
                return Rows(request["refs"])
            if "FROM deck_plugin_bindings" in query:
                return Rows(request["binding"])
            raise ValueError("Unexpected production query")
    snapshot = DeckContentVersionService(SourceFacts())._snapshot(request["deck"])
    base = json.loads(request["base_json"]) if request["base_json"] is not None else None
    json.dump({"canonical_json": _canonical_json(snapshot), "content_hash": _content_hash(snapshot), "changes": [row.model_dump(mode="json") for row in DeckContentVersionService._diff(base, snapshot)]}, sys.stdout, ensure_ascii=True)
elif request["action"] == "confirmation":
    from backend.services.story_workspace.dream_confirmation_service import _sha256, story_workspace_dream_confirmation_message_id
    command = json.loads(request["command_json"])
    json.dump({"command_fingerprint": _sha256({"actor": request["actor"], "command": command}),
               "message_id": story_workspace_dream_confirmation_message_id(request["actor"], command["storyWorkspaceRunId"], command["idempotencyKey"])}, sys.stdout)
else:
    raise ValueError("Unknown oracle action")
