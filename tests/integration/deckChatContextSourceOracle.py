# [Input] Actual Dream DeckChatContextService with fixed Deck/Voice/ref rows and captured query seams.
# [Output] Original selection, error, prompt/provenance and ordering behavior without a real database or filesystem.
# [Pos] Source-only oracle; Admin tests consume its JSON and never import it in production.
# [Sync] 2026-09-15: freeze the pre-Registry105 Dream aggregate behavior before consumer replacement.
import asyncio
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from services.deck import chat_context as original


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class CapturedDatabase:
    def __init__(self, deck, voices):
        self.deck = deck
        self.voices = voices
        self.statements = []

    def execute(self, statement, parameters=()):
        normalized = " ".join(str(statement).split())
        self.statements.append({"sql": normalized, "parameters": list(parameters)})
        if "FROM decks" in normalized:
            return Result([] if self.deck is None else [self.deck])
        if "FROM voices" in normalized:
            return Result(self.voices)
        raise AssertionError("Unexpected source query")


request = json.load(sys.stdin)


def run_case(*, deck=None, voices=None, refs=None, voice_id=None, dream_mode=False):
    database = CapturedDatabase(
        request["deck"] if deck is None else None if deck is False else deck,
        request["voices"] if voices is None else voices,
    )
    selected_refs = request["refs"] if refs is None else refs
    ref_calls = []

    def load_refs(db, deck_id):
        assert db is database
        ref_calls.append(deck_id)
        return selected_refs

    try:
        with patch.object(original, "load_deck_plugin_refs", load_refs):
            context = asyncio.run(original.DeckChatContextService(database).resolve(
                deck_id=request["deck"]["id"],
                actor_id=request["actor_id"],
                voice_id=voice_id,
                dream_mode=dream_mode,
            ))
        return {
            "status": "resolved",
            "context": {
                "deck_id": context.deck_id,
                "deck_name": context.deck_name,
                "system_prompt": context.system_prompt,
                "plugin_refs": list(context.plugin_refs),
                "plugin_provenance": context.plugin_provenance,
            },
            "statements": database.statements,
            "ref_calls": ref_calls,
        }
    except original.DeckChatContextError as error:
        return {
            "status": "error",
            "code": error.code,
            "status_code": error.status_code,
            "message": str(error),
            "statements": database.statements,
            "ref_calls": ref_calls,
        }


print(json.dumps({
    "all": run_case(),
    "selected": run_case(voice_id=request["voices"][1]["id"]),
    "dream": run_case(dream_mode=True),
    "missing_deck": run_case(deck=False),
    "disabled_deck": run_case(deck={**request["deck"], "enabled": False}),
    "missing_voice": run_case(voice_id="voice-absent"),
    "nonready_plugin": run_case(refs=[{**request["refs"][0], "installation_status": "error"}]),
}, ensure_ascii=True, allow_nan=False))
