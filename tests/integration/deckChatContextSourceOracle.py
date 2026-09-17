# [Input] Actual Dream DeckChatContextAssembler with fixed Registry105 DTO snapshots.
# [Output] Dream-owned selection, error, prompt and provenance behavior without a database or filesystem.
# [Pos] Source-only consumer oracle; Admin tests consume its JSON and never import it in production.
# [Sync] 2026-09-16: follow Dream's DTO-only assembler after retirement of its SQL resolver.
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.environ["INK_DREAM_SOURCE"], "backend"))
from services.admin_data.deck_chat_context_data import DeckChatContextOutputDTO
from services.deck import chat_context as original


request = json.load(sys.stdin)


def run_case(*, deck=None, voices=None, refs=None, voice_id=None, dream_mode=False):
    snapshot = DeckChatContextOutputDTO.model_validate(
        {
            "deck": request["deck"] if deck is None else deck,
            "voices": request["voices"] if voices is None else voices,
            "plugin_refs": request["refs"] if refs is None else refs,
        }
    )
    try:
        context = asyncio.run(
            original.DeckChatContextAssembler(
                snapshot,
                selected_voice_id=voice_id,
            ).resolve(dream_mode=dream_mode)
        )
        return {
            "status": "resolved",
            "context": {
                "deck_id": context.deck_id,
                "deck_name": context.deck_name,
                "system_prompt": context.system_prompt,
                "plugin_refs": list(context.plugin_refs),
                "plugin_provenance": context.plugin_provenance,
            },
        }
    except original.DeckChatContextError as error:
        return {
            "status": "error",
            "code": error.code,
            "status_code": error.status_code,
            "message": str(error),
        }


print(
    json.dumps(
        {
            "all": run_case(),
            "selected": run_case(voice_id=request["voices"][1]["id"]),
            "dream": run_case(dream_mode=True),
            "disabled_deck": run_case(deck={**request["deck"], "enabled": False}),
            "missing_voice": run_case(voice_id="voice-absent"),
            "nonready_plugin": run_case(
                refs=[
                    {
                        **request["refs"][0],
                        "installation_status": "error",
                    }
                ]
            ),
        },
        ensure_ascii=True,
        allow_nan=False,
    )
)
