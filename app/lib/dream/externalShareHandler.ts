// [Input] Confidential Dream service, current OAuth actor and named publication/management DTOs.
// [Output] Capability-gated, audited share operations and credential-free public snapshots.
// [Pos] Thin share ingress; each anonymous read rechecks revocation in PostgreSQL.
import {z} from 'zod';
import {eq, and} from 'drizzle-orm';
import {external_shares} from '@ink-memory/db/schema/dream';
import {requiredAuthValue} from '../auth/config';
import {requestIdDto} from '../auth/dto';
import {handleInternalAuthRequest, parseAuthDto} from '../auth/internalHandler';
import {principalForServiceToken} from '../auth/serviceAccessToken';
import {withDataTransaction} from './database';
import {identitySchemaRequirement, runtimePurposeSchemaRequirement} from './schemaRequirements';
import {externalShareRequirement, externalShareOperations, shareTokenDto, shareSnapshotDto, type ExternalShareOperation} from './externalShareDto';
import {ExternalShareRepository} from './externalShareRepository';
import {ReceiptRepository} from './receipts';
export function isExternalShareOperation(name: string): name is ExternalShareOperation {return Object.hasOwn(externalShareOperations, name);}
export async function handleExternalShareOperation(request: Request, name: ExternalShareOperation) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const operation = externalShareOperations[name];
    const envelope = await parseAuthDto(request, z.strictObject({request_id: requestIdDto, input: operation.input}), Number(requiredAuthValue('DREAM_DATA_MAX_BODY_BYTES')));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, runtimePurposeSchemaRequirement, externalShareRequirement], async tx => {
      const actor = await principalForServiceToken(tx, request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '', service, operation.userScope);
      const repository = new ExternalShareRepository(tx, actor.canonical_user_id);
      const action = async () => {
        if (name === 'external-share.create') return repository.create(externalShareOperations[name].input.parse(envelope.input));
        if (name === 'external-share.list') return repository.list(externalShareOperations[name].input.parse(envelope.input));
        const input = externalShareOperations['external-share.get'].input.parse(envelope.input);
        return name === 'external-share.revoke' ? repository.revoke(input.id) : repository.get(input.id);
      };
      return operation.kind === 'read' ? operation.output.parse(await action())
        : new ReceiptRepository(tx, service.id, actor.subject).execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
export async function handlePublicExternalShare(token: string) {
  const headers = {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer'};
  if (!shareTokenDto.safeParse(token).success) return Response.json({error: 'SHARE_UNAVAILABLE'}, {status: 404, headers});
  try {
    const snapshot = await withDataTransaction([externalShareRequirement], async tx => {
      const [row] = await tx.select({snapshot: external_shares.snapshot}).from(external_shares).where(and(eq(external_shares.token, token), eq(external_shares.status, 'active'))).limit(1);
      return row ? shareSnapshotDto.parse(row.snapshot) : null;
    });
    return snapshot ? Response.json(snapshot, {headers}) : Response.json({error: 'SHARE_UNAVAILABLE'}, {status: 404, headers});
  } catch {return Response.json({error: 'SHARE_TEMPORARILY_UNAVAILABLE'}, {status: 503, headers});}
}
