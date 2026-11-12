// [Input] Canonical external-share Zod contracts and an explicit consumer output path.
// [Output] Exact operation descriptors for the Dream Python consumer.
// [Pos] Source generation only; no database, service, secret or validation execution.
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {z} from 'zod';
import {externalShareOperations} from '../app/lib/dream/externalShareDto';
import {canonicalContractJson} from '../app/lib/dream/canonicalContractJson';
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
