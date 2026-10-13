// [Input] Synthetic Anthropic user/read-image results and existing function-call exchanges.
// [Output] Complete image-bearing conversation conversion and compatibility evidence.
// [Pos] Provider-free Images chat adapter tests; no DB, model, account or public-write action.
// [Sync] 2026-10-10: protect upload and image-read tool outputs through Messages to Responses.
import { describe, expect, it } from 'vitest';
import { adaptProviderRequest } from './protocol-adapters';
import { GatewayError } from './errors';

const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } };
function convert(messages: unknown[]) {
  const output = adaptProviderRequest({ externalProtocol: 'anthropic', providerProtocol: 'openai', providerAdapterKind: 'codex', model: 'opaque-chat-alias', maxOutputTokens: 100, body: { messages, tools: [{ name: 'mcp__image_gen__imagegen', input_schema: { type: 'object', properties: { prompt: { type: 'string' } } } }] } });
  if (!('input' in output)) throw new Error('Expected Responses input');
  return output;
}

describe('image-bearing conversation through existing adapters', () => {
  it('preserves upload image/text order and declares only the existing function tool', () => {
    const output = convert([{ role: 'user', content: [image, { type: 'text', text: 'Reference image for editing: workspace://files/upload.png' }, { type: 'text', text: 'Make the background blue' }] }]);
    expect(output.input).toEqual([{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,YWJj' }, { type: 'input_text', text: 'Reference image for editing: workspace://files/upload.png' }, { type: 'input_text', text: 'Make the background blue' }] }]);
    expect(output.tools).toEqual([expect.objectContaining({ type: 'function', name: 'mcp__image_gen__imagegen' })]);
    expect(output.tools).not.toContainEqual(expect.objectContaining({ type: 'image_generation' }));
  });
  it('retains Read image as function output with its call id', () => {
    const output = convert([{ role: 'assistant', content: [{ type: 'tool_use', id: 'call-read-1', name: 'Read', input: { file_path: 'generated/a.png' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-read-1', content: [{ type: 'text', text: 'Image' }, image] }] }]);
    expect(output.input).toEqual(expect.arrayContaining([{ type: 'function_call_output', call_id: 'call-read-1', output: [{ type: 'input_text', text: 'Image' }, { type: 'input_image', image_url: 'data:image/png;base64,YWJj' }] }]));
  });
  it('retains imagegen small JSON result as original text and preserves call id', () => {
    const text = JSON.stringify({ kind: 'image-generation-result', version: 1, images: [{ uri: 'workspace://files/generated/a.png' }] });
    const output = convert([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-image-1', content: text }] }]);
    expect(output.input).toContainEqual({ type: 'function_call_output', call_id: 'call-image-1', output: text });
  });
  it('rejects malformed image sources instead of silently dropping the block', () => {
    expect(() => convert([{ role: 'user', content: [{ type: 'image', source: { type: 'base64' } }] }])).toThrowError(GatewayError);
  });
});
