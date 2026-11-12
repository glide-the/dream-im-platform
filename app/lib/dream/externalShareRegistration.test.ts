// [Input] Frozen Registry297 digest, generated inventory and live share descriptors.
// [Output] Preserved existing contracts and four exact owner-scoped share operations at the tail.
// [Pos] External-share registration regression; no database or service credentials.
import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import inventory from '../../../docs/architecture/admin-dream-operation-contracts.json';
import {canonicalContractJson, dreamOperations} from './operationRegistry';
import {externalShareRequirement} from './externalShareDto';
it('preserves Registry297 and appends exactly the four external-share operations', () => {
  expect(createHash('sha256').update(canonicalContractJson(dreamOperations.slice(0, 297))).digest('hex')).toBe('53af08ffce4f4486c788de994c3d9080d3586211c5e3685d3040d8949a0ac0ff');
  expect(inventory).toEqual(dreamOperations);
  expect(dreamOperations.slice(297).map(item => item.capability.name)).toEqual(['external-share.create', 'external-share.list', 'external-share.get', 'external-share.revoke']);
  for (const item of dreamOperations.slice(297)) {
    expect(item.requirements).toContainEqual(externalShareRequirement);
    expect(item.capability.background_scope).toBeNull();
    expect(item.capability.user_scope).toBe(item.capability.kind === 'read' ? 'dream:read' : 'dream:write');
  }
});
