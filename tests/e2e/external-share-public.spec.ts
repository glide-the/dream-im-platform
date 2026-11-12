// [Input] Real Next public HTTP route and immutable record created by the isolated parent harness.
// [Output] Anonymous active/revoked reads, strict public fields and cache/privacy headers.
// [Pos] API-only Playwright stage; fixtures remain in the parent's disposable database.
import {test, expect} from '@playwright/test';
const token = process.env.EXTERNAL_SHARE_TEST_TOKEN ?? '';
const expected = Number(process.env.EXTERNAL_SHARE_TEST_STATUS);
if (!/^[A-Za-z0-9_-]{43}$/.test(token) || ![200, 404].includes(expected)) throw Error('OWNED_SHARE_HTTP_FIXTURE_REQUIRED');
test('anonymous HTTP output follows current committed state', async ({request}) => {
  const result = await request.get('/api/public/shares/' + token, {headers: {cookie: 'fixture=ignored'}});
  expect(result.status()).toBe(expected);
  expect(result.headers()['cache-control']).toContain('no-store');
  expect(result.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(result.headers()['referrer-policy']).toBe('no-referrer');
  const body = await result.json();
  if (expected === 200) {expect(Object.keys(body).sort()).toEqual(['created_at', 'kind', 'paragraphs', 'title']); expect(body.kind).toBe('note'); expect(body.paragraphs).toEqual(['Public fixture prose']);}
  else expect(body).toEqual({error: 'SHARE_UNAVAILABLE'});
});
test('malformed tokens return the same anonymous unavailable result', async ({request}) => {
  const result = await request.get('/api/public/shares/invalid-file-token');
  expect(result.status()).toBe(404); expect(await result.json()).toEqual({error: 'SHARE_UNAVAILABLE'});
});
