// [Input] Registered catalog operation, actor scope, owned list visibility and injected Drizzle read boundary.
// [Output] Ordered single-batch Voice hydration, empty catalog, strict authority and append-only descriptor evidence.
// [Pos] Provider-free catalog validation; no database connections, writes or Runtime execution.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {inArray} from 'drizzle-orm';
import {voices} from '@ink-memory/db/schema/dream';
import type {DataTransaction} from './database';
import {DeckVoiceRepository,type VoiceEntity} from './deckVoiceRepository';
import {deckVoicePolicyDto} from './deckVoiceDto';
import {runDeckVoiceOperation} from './deckVoiceService';
import {dreamOperations} from './operationRegistry';
import inventory from '../../../docs/architecture/admin-dream-operation-contracts.json';

const policy=deckVoicePolicyDto.parse({default_system_deck_id:'system',retired_system_deck_ids:[],default_plugin_package_name:'plugin',default_plugin_version:'1.0.0',default_memory_workspace_config_json:'{}',template:{name:'System',name_zh:null,name_en:null,description:null,description_zh:null,description_en:null,icon:null,color:null,voices:[]}});
function deck(id:string,enabled=true){return {id,name:id,name_zh:null,name_en:null,description:null,description_zh:null,description_en:null,icon:null,color:null,is_system:false,parent_id:null,owner_id:'42',enabled,has_local_changes:false,order_index:0,published:false,author_name:null,install_count:0,draft_revision:1,latest_version:0,published_draft_revision:0,created_at:null,updated_at:null,agent_type:'chat' as const,agent_type_revision:0,deck_plugin_id:null,deck_plugin_version:null,can_publish:true,publish_block_reason:null,deck_version_capability:true as const,deck_version:null,deck_version_dirty:true,deck_version_status:'unpublished' as const,next_deck_version:1,voice_count:1,total_voice_count:1,author_display_name:null};}
function voice(id:string,deckId:string,enabled=true):VoiceEntity{return {id,deck_id:deckId,name:id,name_zh:null,name_en:null,system_prompt:'Prompt',icon:null,color:null,is_system:false,parent_id:null,owner_id:'42',enabled,has_local_changes:false,order_index:0,created_at:null,updated_at:null,thread_id:null,memory_workspace_config:'{"big":9007199254740993}'};}
const actor={principal:{subject:'actor',canonical_user_id:'42',client_id:'browser',scopes:['dream:read'],status:'active' as const},threadScope:null};
afterEach(()=>vi.restoreAllMocks());

describe('owned Deck/Agent catalog',()=>{
 it('reuses actor list visibility and batches ordered Voices without detail reads',async()=>{
  const items=[deck('second',false),deck('first'),deck('empty')];
  const list=vi.spyOn(DeckVoiceRepository.prototype,'list').mockResolvedValue(items);
  const detail=vi.spyOn(DeckVoiceRepository.prototype,'detail');
  const agents=[voice('disabled','first',false),voice('enabled','first'),voice('other','second')];
  const orderBy=vi.fn().mockResolvedValue(agents),where=vi.fn(()=>({orderBy})),from=vi.fn(()=>({where})),select=vi.fn(()=>({from}));
  const store=new DeckVoiceRepository({select} as unknown as DataTransaction,'42',policy);
  const result=await store.catalog();
  expect(list).toHaveBeenCalledExactlyOnceWith(false);expect(detail).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledTimes(1);expect(from).toHaveBeenCalledExactlyOnceWith(voices);
  expect(where).toHaveBeenCalledExactlyOnceWith(inArray(voices.deck_id,['second','first','empty']));
  expect(orderBy.mock.calls[0]).toHaveLength(4);
  expect(result.map(item=>item.id)).toEqual(['second','first','empty']);
  expect(result[1].voices.map(item=>[item.id,item.enabled])).toEqual([['disabled',false],['enabled',true]]);
  expect(result[1].voices[0].memory_workspace_config_json).toBe('{"big":9007199254740993}');
  expect(result[2].voices).toEqual([]);expect(result[0].enabled).toBe(false);
 });
 it('empty owned list does not issue a Voice query',async()=>{
  vi.spyOn(DeckVoiceRepository.prototype,'list').mockResolvedValue([]);const select=vi.fn();
  expect(await new DeckVoiceRepository({select} as unknown as DataTransaction,'42',policy).catalog()).toEqual([]);expect(select).not.toHaveBeenCalled();
 });
 it('service invokes the catalog once with the verified actor',async()=>{
  const read=vi.spyOn(DeckVoiceRepository.prototype,'catalog').mockImplementation(async function(){expect(this.canonicalUserId).toBe('42');return [{...deck('deck'),voices:[]}];});
  expect(await runDeckVoiceOperation('deck.catalog',{},actor,{} as DataTransaction,policy)).toEqual({decks:[{...deck('deck'),voices:[]}]});expect(read).toHaveBeenCalledTimes(1);
 });
 it.each([
  {input:{owner_id:'99'},actor,code:'INPUT_INVALID'},
  {input:{community:true},actor,code:'INPUT_INVALID'},
  {input:{},actor:{...actor,threadScope:'thread'},code:'DREAM_DELEGATION_SCOPE_REQUIRED'},
  {input:{},actor:{...actor,principal:{...actor.principal,scopes:['dream:write']}},code:'DREAM_SCOPE_REQUIRED'},
 ])('rejects invalid selectors or authority before storage: $code',async scenario=>{
  const read=vi.spyOn(DeckVoiceRepository.prototype,'catalog');
  await expect(runDeckVoiceOperation('deck.catalog',scenario.input,scenario.actor,{} as DataTransaction,policy)).rejects.toMatchObject({code:scenario.code});expect(read).not.toHaveBeenCalled();
 });
 it('appends its exact read capability while retaining list/detail hashes and the generated inventory',()=>{
  expect(dreamOperations.at(-1)?.capability).toEqual({name:'deck.catalog',kind:'read',user_scope:'dream:read',background_scope:null,input_schema_version:1,output_schema_version:1,contract_sha256:'0c53861e1a635742e37f7b26ab954a57af1f550261d3ddc1ea5dbfb17f574a5e'});
  expect(dreamOperations.find(item=>item.capability.name==='deck.list')?.capability.contract_sha256).toBe('4c8b3d396a30c9c3bb534aca04f50e4d90dad37dd9ecb96ad8c217894e6eb8eb');
  expect(dreamOperations.find(item=>item.capability.name==='deck.detail')?.capability.contract_sha256).toBe('52f1448eaa4935c662bec1811633a80d4ffc4ed764503210edc541a99369e964');
  expect(inventory).toEqual(dreamOperations);
 });
});
