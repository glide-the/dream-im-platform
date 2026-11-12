// [Input] Server-projected note/chat prose, canonical source identity and current-user operations.
// [Output] Closed immutable snapshots, owner metadata and publication/list/revocation contracts.
// [Pos] Shared external-share wire boundary; public output excludes owner and source identities.
import {z} from 'zod';
import {isoTimeDto} from '../auth/dto';
import contract from '../../../drizzle/contracts/dream-external-share-v1.json';
export const externalShareRequirement = {capability: contract.capability, version: contract.version, contractSha256: contract.contract_sha256};
export const shareKindDto = z.enum(['chat', 'note']);
export const shareTokenDto = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const common = {title: z.string(), created_at: isoTimeDto.nullable()};
export const shareSnapshotDto = z.discriminatedUnion('kind', [
  z.strictObject({...common, kind: z.literal('note'), paragraphs: z.array(z.string())}),
  z.strictObject({...common, kind: z.literal('chat'), messages: z.array(z.strictObject({role: z.enum(['user', 'assistant']), content: z.string()}))}),
]);
export type ShareSnapshot = z.infer<typeof shareSnapshotDto>;
export const shareMetadataDto = z.strictObject({
  id: z.uuid(), kind: shareKindDto, source_id: z.string().min(1), title: z.string(),
  path: z.string(), status: z.enum(['active', 'revoked']), source_available: z.boolean(),
  created_at: isoTimeDto, revoked_at: isoTimeDto.nullable(),
});
export const shareCreateInputDto = z.strictObject({kind: shareKindDto, source_id: z.string().min(1), snapshot: shareSnapshotDto});
export const shareIdInputDto = z.strictObject({id: z.uuid()});
export const shareListInputDto = z.strictObject({kind: shareKindDto, status: z.enum(['active', 'revoked']),
  limit: z.number().int().min(1).max(100), before: z.strictObject({created_at: isoTimeDto, id: z.uuid()}).nullable()});
export const shareListOutputDto = z.strictObject({shares: z.array(shareMetadataDto),
  counts: z.strictObject({chat: z.number().int().nonnegative(), note: z.number().int().nonnegative()}),
  next_cursor: z.strictObject({created_at: isoTimeDto, id: z.uuid()}).nullable()});
export const externalShareOperations = {
  'external-share.create': {kind: 'write', userScope: 'dream:write', input: shareCreateInputDto, output: z.strictObject({share: shareMetadataDto})},
  'external-share.list': {kind: 'read', userScope: 'dream:read', input: shareListInputDto, output: shareListOutputDto},
  'external-share.get': {kind: 'read', userScope: 'dream:read', input: shareIdInputDto, output: z.strictObject({share: shareMetadataDto.nullable()})},
  'external-share.revoke': {kind: 'write', userScope: 'dream:write', input: shareIdInputDto, output: z.strictObject({share: shareMetadataDto})},
} as const;
export type ExternalShareOperation = keyof typeof externalShareOperations;
