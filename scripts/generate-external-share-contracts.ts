// [Input] Canonical external-share Zod contracts and an explicit consumer output path.
// [Output] Exact consumer descriptors and an explicitly selected append-only operation inventory.
// [Pos] Source generation only; no database, service, secret or validation execution.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {z} from 'zod';
import {externalShareOperations} from '../app/lib/dream/externalShareDto';
import {canonicalContractJson} from '../app/lib/dream/canonicalContractJson';
import {dreamOperations} from '../app/lib/dream/operationRegistry';
const target = process.argv[2];
if (!target) throw Error('An explicit consumer contract output path is required');
const operations = Object.entries(externalShareOperations).map(([name, operation]) => {
  const contract = {name, input_schema_version: 1, output_schema_version: 1,
    input: z.toJSONSchema(operation.input, {io: 'input'}), output: z.toJSONSchema(operation.output, {io: 'output'})};
  return {name, kind: operation.kind, user_scope: operation.userScope, background_scope: null,
    input_schema_version: 1, output_schema_version: 1, contract_sha256: createHash('sha256').update(canonicalContractJson(contract)).digest('hex')};
});
writeFileSync(target, JSON.stringify({operations}, null, 2) + '\n');
process.stdout.write('Generated four external-share operation descriptors.\n');
const registryPath = process.argv[3];
if (registryPath) {
  const previous = readFileSync(registryPath, 'utf8'), entries: unknown = JSON.parse(previous);
  if (!Array.isArray(entries) || entries.length > dreamOperations.length || entries.some((item, index) => canonicalContractJson(item) !== canonicalContractJson(dreamOperations[index]))) throw Error('Existing operation prefix differs from the canonical registry');
  const added = dreamOperations.slice(entries.length).map(item => JSON.stringify(item, null, 2).split('\n').map(line => '  ' + line).join('\n'));
  if (added.length) writeFileSync(registryPath, previous.replace(/\n\]\s*$/, ',\n' + added.join(',\n') + '\n]\n'));
  process.stdout.write('Generated operation inventory with the existing prefix preserved.\n');
}
