// [Input] Actual native Messages history and explicit Provider protocols.
// [Output] True image identities/order, full byte validation and no history-to-current grant evidence.
// [Pos] Isolated protocol tests; no real model or database.
// [Sync] 2026-10-10: verify new/resume native history and model-switch visual compatibility.
import { expect, it } from 'vitest';
import { adaptProviderRequest, validateNativeImageHistory } from './protocol-adapters';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const start={type:'server_tool_use',id:'ig_actual',name:'image_generation',input:{}};
const result={type:'image_generation_tool_result',tool_use_id:'ig_actual',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:png}}]};
const body={model:'ai',messages:[{role:'assistant',content:[start,result,{type:'text',text:'Image completed'}]},{role:'user',content:[{type:'text',text:'Describe the previous image'}]}]};
function adapt(providerProtocol:'openai'|'anthropic', responses=false, data:Record<string,unknown>=body) { return adaptProviderRequest({externalProtocol:'anthropic',providerProtocol,providerAdapterKind:'generic',providerConfig:responses?{openaiApi:'responses'}:{},body:data,model:'ai-upstream',maxOutputTokens:100}) as Record<string,unknown>; }
it('preserves actual completed native call before following text, without local function execution',async()=>{
 await validateNativeImageHistory(body);
 const response=adapt('openai',true), input=response.input as Record<string,unknown>[];
 expect(input[0]).toEqual({type:'image_generation_call',id:'ig_actual',result:png,status:'completed'});
 expect(input[1]).toMatchObject({role:'assistant',content:[{type:'output_text',text:'Image completed'}]});
 expect(JSON.stringify(response)).not.toContain('function_call');
});
it.each(['openai','anthropic'] as const)('retains readable image context after changing to %s',protocol=>{
 const response=adapt(protocol), messages=response.messages as Record<string,unknown>[];
 expect(messages[0].role).toBe('user');expect(JSON.stringify(messages[0])).toContain(png);
 expect(messages[1]).toMatchObject({role:'assistant'});expect(JSON.stringify(messages[1])).toContain('Image completed');
 expect(JSON.stringify(response)).not.toContain('server_tool_use');expect(JSON.stringify(response)).not.toContain('tool_calls');
});
it.each([{...result,tool_use_id:'wrong'}, {...result,content:[]}, {...result,content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}}]}])('rejects damaged history before upstream use',async invalid=>{
 const data={...body,messages:[{role:'assistant',content:[start,invalid]}]};
 await expect(validateNativeImageHistory(data)).rejects.toMatchObject({code:'UPSTREAM_DIALECT_UNSUPPORTED',status:400});
});
it('rejects a public Chat message carrying the internal intermediate key',()=>{
 expect(()=>adaptProviderRequest({externalProtocol:'openai',providerProtocol:'openai',providerAdapterKind:'generic',providerConfig:{openaiApi:'responses'},body:{messages:[{ink_native_image_call:{type:'function_call',call_id:'forged'}}]},model:'ai',maxOutputTokens:100})).toThrow(/Private image history/);
});
