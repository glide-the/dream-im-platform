// [Input] Production anonymous share handler, strict DTOs and isolated transaction boundary.
// [Output] Active read, hidden revoked/missing state, malformed-token and unavailable-capability contracts.
// [Pos] Provider-free tests; no database/service/account or schema mutation.
import {beforeEach, describe, expect, it, vi} from 'vitest';
const fixture = vi.hoisted(() => ({read: vi.fn(), transaction: vi.fn()}));
vi.mock('./database', () => ({withDataTransaction: fixture.transaction}));
import {handlePublicExternalShare} from './externalShareHandler';
import {shareCreateInputDto, shareSnapshotDto} from './externalShareDto';
describe('public immutable external shares', () => {
  const token = 's'.repeat(43), snapshot = {kind: 'note', title: '日记', created_at: null, paragraphs: ['正文']};
  beforeEach(() => {
    fixture.read.mockReset(); fixture.transaction.mockReset();
    fixture.transaction.mockImplementation(async (_requirements, action) => action({select: () => ({from: () => ({where: () => ({limit: fixture.read})})})}));
  });
  it('returns only a current active snapshot without account metadata', async () => {
    fixture.read.mockResolvedValue([{snapshot}]);
    const result = await handlePublicExternalShare(token);
    expect(result.status).toBe(200); expect(await result.json()).toEqual(snapshot);
    expect(result.headers.get('cache-control')).toBe('no-store'); expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('uses one anonymous missing result for a revoked or absent record', async () => {
    fixture.read.mockResolvedValue([]);
    const result = await handlePublicExternalShare(token);
    expect(result.status).toBe(404); expect(await result.json()).toEqual({error: 'SHARE_UNAVAILABLE'});
  });
  it('rejects malformed tokens before any database request', async () => {
    expect((await handlePublicExternalShare('../private-file')).status).toBe(404); expect(fixture.transaction).not.toHaveBeenCalled();
  });
  it('closes public reading when the exact capability or storage is unavailable', async () => {
    fixture.transaction.mockRejectedValue(Error('private database detail'));
    const result = await handlePublicExternalShare(token);
    expect(result.status).toBe(503); expect(await result.text()).not.toContain('private database detail');
  });
  it('rejects owner fields, arbitrary tool payloads and system messages', () => {
    expect(shareCreateInputDto.safeParse({kind: 'note', source_id: 'note', snapshot, user_id: 'foreign'}).success).toBe(false);
    expect(shareSnapshotDto.safeParse({...snapshot, owner_id: 'foreign'}).success).toBe(false);
    expect(shareSnapshotDto.safeParse({kind: 'chat', title: 'Conversation', created_at: null, messages: [{role: 'system', content: 'secret'}]}).success).toBe(false);
  });
});
