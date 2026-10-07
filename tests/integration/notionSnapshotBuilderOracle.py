# [Input] Current Dream snapshot builder with fake remote metadata and no credentials or database.
# [Output] Actual canonical lightweight payload for the Admin strict finish DTO compatibility gate.
# [Pos] Cross-project provider-free source oracle; not Dream execution/cache integration acceptance.
# [Sync] 2026-10-07: preserve upstream page timestamps and selected independent-page metadata.
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(sys.argv[1]).resolve() / "backend"))
from notion.sync import build_canonical_snapshot

connector_id = "11111111-1111-4111-8111-111111111111"
page_id = "22222222-2222-4222-8222-222222222222"
standalone_id = "33333333-3333-4333-8333-333333333333"
database_id = "44444444-4444-4444-8444-444444444444"
def page(identifier):
    return {"object": "page", "id": identifier, "created_time": "2026-10-07T00:00:00Z", "last_edited_time": "2026-10-07T00:01:00Z", "url": "https://example.invalid/page", "archived": False, "in_trash": False,
            "properties": {"Name": {"type": "title", "title": [{"plain_text": "Metadata fixture"}]}}}
class Operations:
    async def query_database(self, query):
        return SimpleNamespace(results=[page(page_id)], has_more=False, next_cursor=None)
    async def get_page_metadata(self, identifier):
        return page(identifier)

async def main():
    connector = {"id": connector_id, "name": "Notion", "platform": "notion", "auth_status": "authenticated", "last_synced_at": None}
    resources = [{"resource_type": "notion_database", "external_id": database_id, "title": "Database", "metadata": {}},
                 {"resource_type": "notion_page", "external_id": standalone_id, "title": "Independent page", "metadata": {}}]
    snapshot = await build_canonical_snapshot(connector=connector, selected_resources=resources, workspace_id=connector_id, operations=Operations())
    assert snapshot["pages"] == {}
    assert len(snapshot["index"]) == 2
    assert all(item["created_time"] == "2026-10-07T00:00:00Z" for item in snapshot["index"])
    print(json.dumps(snapshot))
asyncio.run(main())
