# [Input] Primary-owned isolated Admin HTTP fixture and explicit current Dream source/interpreter.
# [Output] Real Dream consumer/receipt/cache integration receipts plus a renewal-cancellation regression gate.
# [Pos] Provider-free technical integration; only upstream Notion metadata and transport timing are injected.
# [Sync] 2026-10-07: call actual Admin production routes and Dream factory without editing Dream or normal services.
import asyncio
import hashlib
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

fixture_path, source_root, runtime_root = map(lambda value: Path(value).resolve(), sys.argv[1:4])
fixture = json.loads(fixture_path.read_text())
if not fixture['databaseName'].startswith('ink_notion_sync_ownership_test_'):
    raise RuntimeError('Named isolation proof required')
if runtime_root.parent != fixture_path.parent or not runtime_root.is_dir():
    raise RuntimeError('Primary-owned private runtime required')
origin = fixture['env']['BETTER_AUTH_URL'].removesuffix('/api/auth')
if urlparse(origin).hostname != '127.0.0.1':
    raise RuntimeError('Loopback Admin required')
sys.path.insert(0, str(source_root / 'backend'))
os.environ['INK_NOTION_RUNTIME_ROOT'] = str(runtime_root / 'credentials')
import httpx
from services.admin_data.client import AdminDataClient
from services.admin_data.config import AdminDataConfig
from services.admin_data.notion_connector_data import (
    AdminNotionConnectorData, NOTION_CONNECTOR_OPERATIONS, NOTION_SYNC_RUN_OPERATIONS,
)
from services.admin_data.preferences_data import PREFERENCES_OPERATIONS
from services.admin_data.preferences_data import AdminPreferencesData, PreferencesSaveRequestDTO
from notion.credentials import NOTION_AUTH_FILENAME, NotionCredentialSettings, NotionCredentialStore
from notion.errors import NotionOperationError, NotionSyncBusyError
from notion.factory import build_notion_facade
from notion.store import NotionConnectorStore

source_files = ['backend/notion/factory.py', 'backend/notion/store.py',
    'backend/notion/snapshot_store.py', 'backend/notion/sync_scheduler.py',
    'backend/services/admin_data/notion_connector_data.py', 'backend/services/admin_data/client.py',
    'backend/notion/credentials.py', 'backend/notion/sync.py', 'backend/notion/today.py',
    'backend/notion/errors.py', 'backend/notion/sync_policy.py', 'backend/routers/notion.py']
def source_hashes():
    return {name: hashlib.sha256((source_root / name).read_bytes()).hexdigest() for name in source_files}
before_hashes = source_hashes()
receipts = []
def record(name, **details):
    entry = {'case': name, **details}
    receipts.append(entry)
    print(json.dumps(entry), flush=True)

services = json.loads(fixture['env']['DREAM_DATA_SERVICE_CLIENTS'])
config = AdminDataConfig(base_url=origin, issuer=origin + '/api/auth',
    resource=fixture['env']['DREAM_API_RESOURCE'], service_client_id=services[0]['id'],
    service_secret=services[0]['secret'], timeout_seconds=5,
    transport_base_url=fixture.get('transportBaseUrl'))
drop = {'next_finish': False, 'count': 0}
transport_calls = []
clock = {'offset_seconds': 0}
def transport_hook(request):
    transport_calls.append(request.url.path)
    if clock['offset_seconds']:
        request.headers['x-harness-clock-offset-seconds'] = str(clock['offset_seconds'])
    if drop['next_finish'] and request.url.path.endswith('/operations/notion.sync-run.finish'):
        drop['next_finish'] = False
        drop['count'] += 1
        request.headers['x-harness-drop-response'] = 'after-commit'
http = httpx.Client(timeout=5, follow_redirects=False, trust_env=False,
    event_hooks={'request': [transport_hook]})
client = AdminDataClient(config, client=http,
    operations=(*NOTION_CONNECTOR_OPERATIONS, *NOTION_SYNC_RUN_OPERATIONS, *PREFERENCES_OPERATIONS),
    service_token_provider=lambda: fixture['tokens']['service'])
data = AdminNotionConnectorData(client)
user_store = NotionConnectorStore(data, access_token=fixture['tokens']['user'], expected_user_id=101)
background_store = NotionConnectorStore(data, background=True)
workspaces = runtime_root / 'workspaces'
workspaces.mkdir(mode=0o700)
credentials = NotionCredentialStore(NotionCredentialSettings(runtime_root=runtime_root / 'credentials'),
    workspace_root_provider=lambda: workspaces)
auth_file = credentials.user_paths(101).home / NOTION_AUTH_FILENAME
auth_file.write_text('{"fixture":"synthetic-notion-provider"}')
auth_file.chmod(0o600)

database_id, first_page, second_page = (str(uuid4()) for _ in range(3))
class Remote:
    fail = False
    rotate = False
    include_second = True
    queries = []
    def __init__(self, home, **kwargs):
        assert Path(home) == auth_file.parent
    @staticmethod
    def page(identifier):
        return {'object': 'page', 'id': identifier, 'created_time': '2026-10-07T00:00:00Z',
            'last_edited_time': '2026-10-07T00:01:00Z', 'url': 'https://example.invalid/page',
            'archived': False, 'in_trash': False,
            'properties': {'Name': {'type': 'title', 'title': [{'plain_text': 'Metadata fixture'}]}}}
    async def query_database(self, query):
        if self.fail:
            raise NotionOperationError('Explicit fake upstream failure')
        cursor = getattr(query, 'start_cursor', None)
        self.queries.append(cursor)
        if self.rotate:
            auth_file.write_text('{"fixture":"rotated-synthetic-notion-provider"}')
            self.rotate = False
        return SimpleNamespace(results=[self.page(second_page if cursor else first_page)],
            has_more=self.include_second and not bool(cursor),
            next_cursor='next-fixture-page' if self.include_second and not cursor else None)
    async def get_page_metadata(self, identifier):
        return self.page(identifier)

def new_connector(name):
    connector = user_store.create_connector(101, name)
    key = connector['id']
    user_store.save_auth_state(key, 101, auth_status='authenticated')
    return key, build_notion_facade(101, key, credential_store=credentials, connector_store=user_store)

def restart(key):
    return build_notion_facade(101, key, credential_store=credentials, connector_store=user_store)

async def cancellation_case():
    cancel_key, cancelled = new_connector('Renewal cancellation regression')
    user_store.replace_connector_resources(cancel_key, 101,
        [{'database_id': database_id, 'title': 'Fixture database'}], [])
    started = threading.Event()
    observed = []
    original_renew = user_store.renew_sync_run
    original_finish = user_store.finish_sync_run
    delay = json.loads(fixture['env']['NOTION_SYNC_EXECUTION_POLICY_JSON'])['renewal_budget_seconds'] + 0.25
    def delayed_renew(*args):
        result = original_renew(*args)
        started.set()
        time.sleep(delay)  # Explicit finite transport-ack delay, no Admin state emulation.
        return result
    def cancelled_finish(*args):
        observed.append(args[2]['status'])
        return original_finish(*args)
    with patch.object(user_store, 'renew_sync_run', delayed_renew), patch.object(user_store, 'finish_sync_run', cancelled_finish):
        task = asyncio.create_task(cancelled.sync())
        assert await asyncio.to_thread(started.wait, 4), 'Renew transport did not start'
        task.cancel()
        result = await asyncio.gather(task, return_exceptions=True)
        assert isinstance(result[0], asyncio.CancelledError)
    record('cancel_during_renewal_beyond_budget', passed=not observed,
        late_ack_seconds=delay, terminal_after_budget=observed,
        expected='no new finish after renewal budget')
    assert not observed, 'DREAM_RENEWAL_CANCELLATION_BUDGET_BYPASS: late renewal ack followed by committed terminal'

async def public_case():
    from fastapi import FastAPI
    from services.admin_data.request_auth import AdminRequestActor, AdminRequestAuth
    from routers import notion as routes
    from notion.sync_scheduler import NotionSnapshotSyncWorker
    # Authenticated request dependency injection; Admin revalidates the real signed
    # subject, service, scopes and current ownership on every production operation.
    owner = AdminRequestAuth(config, client=client)
    actor = AdminRequestActor(subject='notion-subject-101', canonical_user_id='101',
        client_id=services[0]['oauthClientId'], scopes=frozenset({'dream:read', 'dream:write'}),
        issued_at=int(time.time()), expires_at=int(time.time()) + 300, access_token=fixture['tokens']['user'])
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_current_user] = actor.current_user_projection
    app.dependency_overrides[routes.get_admin_request_auth] = lambda: owner
    AdminPreferencesData(client).save(PreferencesSaveRequestDTO(timezone='UTC').domain_input(),
        str(uuid4()), access_token=fixture['tokens']['user'])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://dream.invalid') as api:
        async def checked(method, path, expected=200, **kwargs):
            response = await api.request(method, path, **kwargs)
            assert response.status_code == expected, (path, response.status_code, response.text)
            return response
        with patch('notion.factory.operations.NotionOperationClient', Remote):
            response = await checked('POST', '/api/connectors', json={'name': 'Public route technical journey'})
            key = response.json()['connector']['id']
            user_store.save_auth_state(key, 101, auth_status='authenticated')
            selection = {'selected_databases': [{'database_id': database_id, 'title': 'Fixture database'}], 'selected_pages': []}
            Remote.fail = True
            failed = await api.post(f'/api/connectors/{key}/resources/select', json=selection)
            assert failed.status_code >= 400 and failed.json()['detail']['selection_saved'] is True
            Remote.fail = False
            resources = (await checked('GET', f'/api/connectors/{key}/resources')).json()['resources']
            assert len(resources) == 1
            recovered = (await checked('POST', f'/api/connectors/{key}/sync')).json()
            assert recovered['synced'] and recovered['pageCount'] == 2
            disabled = (await checked('PUT', f'/api/connectors/{key}/sync-policy',
                json={'enabled': False, 'interval_minutes': 15})).json()['connector']
            assert disabled['sync_policy']['desired']['enabled'] is False
            skipped = await build_notion_facade(101, key, connector_store=background_store).sync()
            assert skipped['synced'] is False
            manual = (await checked('POST', f'/api/connectors/{key}/sync')).json()
            assert manual['synced'] is True
            held = user_store.begin_sync_run(key, 101)
            busy = await checked('POST', f'/api/connectors/{key}/sync', expected=409)
            assert busy.json()['detail']['error_code'] == 'NOTION_SYNC_BUSY'
            assert busy.headers['retry-after'].isdecimal()
            user_store.finish_sync_run(key, held.run, {'status': 'cancelled', 'error_code': 'NOTION_SYNC_CANCELLED'})
            docs = (await checked('GET', f'/api/connectors/{key}/notion/documents?date_key=2026-10-07')).json()
            assert first_page in json.dumps(docs) and second_page in json.dumps(docs)
            record('public_selection_failure_readback_explicit_retry_disabled_manual_busy_calendar', passed=True,
                actual_dream_router=True, actual_admin=True, browser_auth_injected=True)

            # Advance only the explicitly prepared harness clock beyond the current
            # actual product interval. Admin still executes its DB clock and UOW.
            worker_key, worker_facade = new_connector('Background new page technical journey')
            Remote.include_second = False
            first = await worker_facade.select_resources(selection['selected_databases'], [])
            assert first['pageCount'] == 1
            Remote.include_second = True
            clock['offset_seconds'] = first['connector']['sync_policy']['effective']['interval_minutes'] * 60 + 1
            worker = NotionSnapshotSyncWorker(
                candidate_provider=lambda: [background_store.get_connector(worker_key, 101)],
                facade_factory=lambda user, connector: build_notion_facade(user, connector, connector_store=background_store))
            sweep = await worker.sync_due_once()
            clock['offset_seconds'] = 0
            assert sweep.attempted == 1 and sweep.succeeded == 1 and sweep.failed == 0, sweep
            fresh = (await checked('GET', f'/api/connectors/{worker_key}/notion/documents?date_key=2026-10-07')).json()
            assert first_page in json.dumps(fresh) and second_page in json.dumps(fresh)
            record('actual_background_worker_new_page_public_calendar', passed=True,
                first_pages=1, after_pages=2, actual_admin_claim=True)
    owner.close()

async def main():
    if len(sys.argv) == 5 and sys.argv[4] == '--public-only':
        record('consumer_scope', scope='public-only', other_cases_skipped=True)
        await public_case()
        assert before_hashes == source_hashes(), 'Dream source changed during public-only execution'
        return
    if len(sys.argv) == 5 and sys.argv[4] == '--renewal-only':
        record('consumer_scope', scope='renewal-only', other_cases_skipped=True)
        await cancellation_case()
        assert before_hashes == source_hashes(), 'Dream source changed during renewal-only execution'
        return
    key, facade = new_connector('Dream consumer metadata integration')
    with patch('notion.factory.operations.NotionOperationClient', Remote):
        accepted = await facade.select_resources([{'database_id': database_id, 'title': 'Fixture database'}], [])
        assert accepted['synced'] and len(accepted['snapshot']['index']) == 2
        assert Remote.queries == [None, 'next-fixture-page']
        v1, c1 = accepted['snapshot'], accepted['connector']
        assert restart(key).get_current_snapshot() == v1
        today = await restart(key).today_pages('2026-10-07', 'UTC',
            now=datetime(2026, 10, 7, 1, tzinfo=timezone.utc))
        assert first_page in json.dumps(today) and second_page in json.dumps(today)
        workspace = workspaces / 'owned-thread'
        workspace.mkdir(mode=0o700)
        restart(key).materialize_workspace(workspace)
        assert any(path.is_file() for path in workspace.rglob('*'))
        record('selection_pagination_finish_calendar_thread', passed=True, pages=2, actual_admin=True)

        held = await asyncio.to_thread(user_store.begin_sync_run, key, 101)
        assert held.status == 'claimed'
        try:
            await facade.sync()
            raise AssertionError('Manual busy must fail')
        except NotionSyncBusyError:
            pass
        background = build_notion_facade(101, key, credential_store=credentials, connector_store=background_store)
        assert (await background.sync())['synced'] is False
        user_store.finish_sync_run(key, held.run, {'status': 'cancelled', 'error_code': 'NOTION_SYNC_CANCELLED'})
        assert facade.get_current_snapshot() == v1
        record('manual_busy_background_skip_cancel_preserves_lkg', passed=True)

        Remote.fail = True
        try:
            await facade.sync()
            raise AssertionError('Upstream failure must fail')
        except NotionOperationError:
            pass
        finally:
            Remote.fail = False
        assert restart(key).get_current_snapshot() == v1
        record('upstream_failure_preserves_lkg', passed=True)

        drop['next_finish'] = True
        with patch.object(facade.snapshot_store, 'cache_accepted', side_effect=OSError('Owned cache fault')):
            accepted2 = await facade.sync()
        assert drop['count'] == 1
        assert any('/receipts/' in path for path in transport_calls)
        v2 = accepted2['snapshot']
        assert v2['metadata']['snapshot_version'] != v1['metadata']['snapshot_version']
        # A late old cache writer cannot replace the file for the current accepted version.
        facade.snapshot_store.cache_accepted(101, c1, v1)
        facade.snapshot_store.publish_current(101, key, v1)
        assert restart(key).get_current_snapshot() == v2
        record('lost_finish_response_cache_failure_restart_late_old_cache', passed=True,
            actual_receipt_recovery=True, late_old_version_rejected=True)

        changed_key, changed = new_connector('Credential context integration')
        user_store.replace_connector_resources(changed_key, 101,
            [{'database_id': database_id, 'title': 'Fixture database'}], [])
        finishes = []
        original_finish = user_store.finish_sync_run
        def observed_finish(*args):
            finishes.append(args[2]['status'])
            return original_finish(*args)
        Remote.rotate = True
        with patch.object(user_store, 'finish_sync_run', observed_finish):
            try:
                await changed.sync()
                raise AssertionError('Credential rotation must fail')
            except Exception as error:
                assert type(error).__name__ == 'NotionCredentialError', type(error).__name__
        assert not finishes and changed.get_current_snapshot() is None
        record('credential_rotation_stops_without_terminal_or_cache', passed=True)

        await cancellation_case()
        after_hashes = source_hashes()
        record('source_fingerprint', before=before_hashes, after=after_hashes, stable=before_hashes == after_hashes)
        assert before_hashes == after_hashes, 'Dream source changed during execution; receipt belongs to captured versions'

try:
    asyncio.run(main())
finally:
    after_hashes = source_hashes()
    record('source_fingerprint_final', before=before_hashes, after=after_hashes, stable=before_hashes == after_hashes)
    http.close()
