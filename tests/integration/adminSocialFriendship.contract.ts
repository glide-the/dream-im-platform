// [Input] Primary-prepared named Social61 facts and restricted AUTH/DATA OAuth actors; private0600 config required.
// [Output] All nine production operations, relationship permissions, precise projections and original concurrent receipts.
// [Pos] Provider-free contract harness; verification connection executes SELECT only, no fixture/fault SQL.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { socialFriendshipOperationContracts as contracts, type SocialFriendshipOperation } from "../../app/lib/dream/socialFriendshipDto";
import { pgTimestampToIso } from "../../app/lib/dream/chatThreadDto";
const text = z.string().min(1);
const fixtureDto = z.strictObject({
 database:text, port:z.number().int().positive(), data_directory:text, target_verification_url:text, issuer:text, service_id:text, service_access_token:text,
 actors:z.strictObject({a:text,b:text,c:text}), tokens:z.strictObject({a:text,b:text,c:text,read_only:text,thread:text}),
 labels:z.strictObject({a:text,b:text,c:text}), emails:z.strictObject({a:text,b:text,c:text}),
});
const path=process.env.INK_AUTH_SOCIAL_FRIENDSHIP_FIXTURE;assert(path,"Primary-prepared private fixture required");assert.equal((await stat(path)).mode&0o777,0o600);
const f=fixtureDto.parse(JSON.parse(await readFile(path,"utf8")));assert(f.database.startsWith("ink_auth_data_codex_test_")&&f.database.endsWith("_social61")&&f.port!==5433&&f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"));
const dsn=new URL(f.target_verification_url);assert(["postgres:","postgresql:"].includes(dsn.protocol)&&decodeURIComponent(dsn.pathname.slice(1))===f.database);
const verification=new Client({connectionString:f.target_verification_url});await verification.connect();
const proof=await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root");assert.deepEqual(proof.rows[0],{name:f.database,port:f.port,root:f.data_directory});
const origin=f.issuer.replace(/\/api\/auth$/,"");let assertions=0;const seen=new Set<SocialFriendshipOperation>();
const id=()=>`social_${randomUUID()}`;
function headers(token:string,requestId:string){return {authorization:`Bearer ${token}`,"content-type":"application/json","x-request-id":requestId,"x-ink-dream-service-authorization":`Bearer ${f.service_access_token}`};}
function same(actual:unknown,expected:unknown,label?:string){assert.deepEqual(actual,expected,label);assertions++;}
function check(value:unknown,label:string){assert(value,label);assertions++;}
type Result<N extends SocialFriendshipOperation>=z.output<(typeof contracts)[N]["output"]>;
async function call<N extends SocialFriendshipOperation>(name:N,input:unknown={},options:{token?:string;status?:number;requestId?:string}={}){
 const requestId=options.requestId??id(),r=await POST(new Request(`${origin}/api/internal/dream/v1/operations/${name}`,{method:"POST",headers:headers(options.token??f.tokens.a,requestId),body:JSON.stringify({request_id:requestId,input})}),{params:Promise.resolve({operation:name})});
 const body=await r.json(),error=typeof body.error?.code==="string"&&/^[A-Z0-9_]{1,100}$/.test(body.error.code)?body.error.code:"NO_PUBLIC_ERROR";
 same(r.status,options.status??200,`${name}: ${error}`);same(body.request_id,requestId);seen.add(name);
 return r.ok?contracts[name].output.parse(body.data) as Result<N>:null;
}
async function receipt(requestId:string,name:SocialFriendshipOperation,token=f.tokens.a,status=200){const r=await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${requestId}?operation=${name}`,{headers:headers(token,requestId)}),{params:Promise.resolve({requestId})});const b=await r.json();same(r.status,status);same(b.request_id,requestId);return b.data;}
async function invite(code:string){return (await verification.query("SELECT code,user_id::text AS inviter_id,used_by::text AS used_by,used_at::text AS used_at,expires_at::text AS expires_at FROM public.friend_invites WHERE code=$1",[code])).rows[0]??null;}
async function request(requestId:string){return (await verification.query("SELECT id::text,user_id::text AS requester_id,friend_id::text AS recipient_id,status,created_at::text,updated_at::text FROM public.friendships WHERE id=$1::bigint",[requestId])).rows[0]??null;}
async function pair(a:string,b:string){return (await verification.query("SELECT id::text,user_id::text AS requester_id,friend_id::text AS recipient_id,status FROM public.friendships WHERE (user_id=$1::bigint AND friend_id=$2::bigint) OR (user_id=$2::bigint AND friend_id=$1::bigint) ORDER BY id",[a,b])).rows;}
async function counts(requestId:string,name:SocialFriendshipOperation){return (await verification.query("SELECT (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id=$1 AND operation=$2) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE request_id=$1 AND action=$3) AS audits",[requestId,name,'dream.'+name])).rows[0];}
const failed=(error:string)=>({success:false,error});
try{
 same((await call("friendship.list",{}))?.friends,[]);same((await call("friend-request.list",{}))?.requests,[]);
 const generate=id(),generated=await call("friend-invite.generate",{},{requestId:generate});check(generated&&/^[A-Z0-9]{6}$/.test(generated.code),"original configured six-character alphabet");assert(generated);
 const generatedStored=await invite(generated.code);check(generatedStored&&generatedStored.used_by===null,"new code unused and owned");same(generatedStored.inviter_id,f.actors.a);same(pgTimestampToIso(generatedStored.expires_at),generated.expires_at);
 const expiry=await verification.query("SELECT extract(epoch FROM expires_at-created_at) AS seconds FROM public.friend_invites WHERE code=$1",[generated.code]);check(Number(expiry.rows[0].seconds)>=604800&&Number(expiry.rows[0].seconds)<604805,"legacy seven-day policy from explicit fixture server config");
 same(await call("friend-invite.generate",{},{requestId:generate}),generated);same(await invite(generated.code),generatedStored);same(await counts(generate,"friend-invite.generate"),{receipts:1,audits:1});same((await receipt(generate,"friend-invite.generate")).result,generated);
 same(await call("friend-invite.use",{code:generated.code}),failed("Cannot add yourself as friend"));same(await invite(generated.code),generatedStored);
 for(const [code,error] of [["MISSING","Invalid invite code"],["EXP001","Invite code expired"],["USED01","Invite code already used"],["HUSED1","Invite code already used"]]){const before=await invite(code);same(await call("friend-invite.use",{code},{token:f.tokens.b}),failed(error));same(await invite(code),before);}
 const firstUse=id(),first=await call("friend-invite.use",{code:"ALPHA1"},{token:f.tokens.b,requestId:firstUse});check(first?.success,"first invite creates pending request");assert(first?.success);
 same(first.inviter_id,f.actors.a);same(first.inviter_name,f.labels.a);const firstRow=await request(first.friend_request_id);check(firstRow&&firstRow.requester_id===f.actors.b&&firstRow.recipient_id===f.actors.a&&firstRow.status==="pending","exact canonical pending direction");
 const consumed=await invite("ALPHA1");same(consumed.used_by,f.actors.b);check(consumed.used_at!==null,"consumption in same successful transaction");
 same(await call("friend-invite.use",{code:"ALPHA1"},{token:f.tokens.b,requestId:firstUse}),first);same(await request(first.friend_request_id),firstRow);same(await invite("ALPHA1"),consumed);same(await counts(firstUse,"friend-invite.use"),{receipts:1,audits:1});
 const wrongInputBefore=await invite("ALPHA2");await call("friend-invite.use",{code:"ALPHA2"},{token:f.tokens.b,requestId:firstUse,status:409});same(await invite("ALPHA2"),wrongInputBefore);
 const pending=await call("friend-request.list",{});same(pending?.requests,[{id:first.friend_request_id,requester_id:f.actors.b,requester_name:f.labels.b,created_at:pgTimestampToIso(firstRow.created_at)}]);same((await call("friend-request.list",{},{token:f.tokens.b}))?.requests,[]);
 same(await call("friend-invite.use",{code:"ALPHA3"},{token:f.tokens.b}),failed("Friend request already pending"));same((await invite("ALPHA3")).used_by,null);
 same(await call("friend-request.accept",{request_id:first.friend_request_id},{token:f.tokens.b}),failed("Permission denied"));same(await call("friend-request.reject",{request_id:first.friend_request_id},{token:f.tokens.c}),failed("Permission denied"));same(await request(first.friend_request_id),firstRow);
 same(await call("friend-request.accept",{request_id:"9223372036854775807"}),failed("Request not found"));same(await call("friend-request.reject",{request_id:"9223372036854775807"}),failed("Request not found"));
 same(await call("friend-request.reject",{request_id:first.friend_request_id}),{success:true});same((await request(first.friend_request_id)).status,"rejected");same((await call("friend-request.list",{}))?.requests,[]);
 same(await call("friend-request.accept",{request_id:first.friend_request_id}),failed("Request already rejected"));
 const resumed=await call("friend-invite.use",{code:"ALPHA2"},{token:f.tokens.b});check(resumed?.success,"rejected same-direction request is reusable");assert(resumed?.success);same(resumed.friend_request_id,first.friend_request_id);same((await request(first.friend_request_id)).status,"pending");same((await pair(f.actors.a,f.actors.b)).length,1);
 const approve=id();same(await call("friend-request.accept",{request_id:first.friend_request_id},{requestId:approve}),{success:true});const accepted=await request(first.friend_request_id);same(accepted.status,"accepted");
 same(await call("friend-request.accept",{request_id:first.friend_request_id},{requestId:approve}),{success:true});same(await request(first.friend_request_id),accepted);same(await counts(approve,"friend-request.accept"),{receipts:1,audits:1});
 same(await call("friend-request.accept",{request_id:first.friend_request_id}),failed("Request already accepted"));same(await call("friend-request.reject",{request_id:first.friend_request_id}),failed("Request already accepted"));
 same(await call("friend-invite.use",{code:"ALPHA3"},{token:f.tokens.b}),failed("Already friends"));same((await invite("ALPHA3")).used_by,null);
 same((await call("friendship.list",{}))?.friends,[{friend_id:f.actors.b,friend_name:f.labels.b,friend_email:f.emails.b,since:pgTimestampToIso(accepted.updated_at)}]);same((await call("friendship.list",{},{token:f.tokens.b}))?.friends,[{friend_id:f.actors.a,friend_name:f.labels.a,friend_email:f.emails.a,since:pgTimestampToIso(accepted.updated_at)}]);
 const pictureRows=(await verification.query("SELECT date,COALESCE(thumbnail_base64,image_base64) AS base64,prompt,created_at::text FROM public.daily_pictures WHERE user_id=$1::bigint ORDER BY date DESC,id DESC",[f.actors.b])).rows.map(row=>({...row,created_at:pgTimestampToIso(row.created_at)}));
 same((await call("friendship.timeline",{friend_id:f.actors.b,limit:30}))?.pictures,pictureRows);same((await call("friendship.timeline",{friend_id:f.actors.b,limit:1}))?.pictures,pictureRows.slice(0,1));same((await call("friendship.timeline",{friend_id:f.actors.b,limit:0}))?.pictures,[]);
 same(await call("friendship.picture-full",{friend_id:f.actors.b,date:"2026-09-14"}),{image_base64:"full-new"});same(await call("friendship.picture-full",{friend_id:f.actors.b,date:"missing-date"}),{image_base64:null});
 same(await call("friendship.timeline",{friend_id:f.actors.b,limit:30},{token:f.tokens.c}),{pictures:null});same(await call("friendship.picture-full",{friend_id:f.actors.b,date:"2026-09-14"},{token:f.tokens.c}),{image_base64:null});same(await call("friendship.timeline",{friend_id:f.actors.c,limit:30}),{pictures:null});
 const removal=id();same(await call("friendship.remove",{friend_id:f.actors.b},{requestId:removal}),{success:true});same(await pair(f.actors.a,f.actors.b),[]);same(await call("friendship.remove",{friend_id:f.actors.b},{requestId:removal}),{success:true});same(await counts(removal,"friendship.remove"),{receipts:1,audits:1});same(await call("friendship.remove",{friend_id:f.actors.b}),failed("Friendship not found"));same(await call("friendship.timeline",{friend_id:f.actors.b,limit:30}),{pictures:null});same(await call("friendship.picture-full",{friend_id:f.actors.b,date:"2026-09-14"}),{image_base64:null});
 const concurrentCode=await Promise.all([call("friend-invite.use",{code:"PAIRAB"},{token:f.tokens.b}),call("friend-invite.use",{code:"PAIRAB"},{token:f.tokens.b})]);same(concurrentCode.filter(v=>v?.success).length,1);same(concurrentCode.filter(v=>v?.success===false).length,1);same(concurrentCode.find(v=>v?.success===false),failed("Invite code already used"));const ab=await pair(f.actors.a,f.actors.b);same(ab.length,1);same(ab[0].status,"pending");same((await invite("PAIRAB")).used_by,f.actors.b);
 const duplicate=id(),dup=await Promise.all([call("friend-invite.use",{code:"REPLAY"},{token:f.tokens.b,requestId:duplicate}),call("friend-invite.use",{code:"REPLAY"},{token:f.tokens.b,requestId:duplicate})]);same(dup[0],dup[1]);check(dup[0]?.success,"original concurrent request returns one successful result");same((await pair(f.actors.b,f.actors.c)).length,1);same(await counts(duplicate,"friend-invite.use"),{receipts:1,audits:1});
 const reciprocal=await Promise.all([call("friend-invite.use",{code:"ACPAIR"},{token:f.tokens.c}),call("friend-invite.use",{code:"CAPAIR"},{token:f.tokens.a})]);same(reciprocal.filter(v=>v?.success).length,1);same(reciprocal.filter(v=>v?.success===false).length,1);same(reciprocal.find(v=>v?.success===false),failed("Friend request already pending"));same((await pair(f.actors.a,f.actors.c)).length,1);const acCodes=await Promise.all([invite("ACPAIR"),invite("CAPAIR")]);same(acCodes.filter(v=>v.used_by!==null).length,1);
 const decisions=await Promise.all([call("friend-request.accept",{request_id:ab[0].id}),call("friend-request.reject",{request_id:ab[0].id})]);same(decisions.filter(v=>v?.success).length,1);same(decisions.filter(v=>v?.success===false).length,1);const final=await request(ab[0].id);check(["accepted","rejected"].includes(final.status),"one terminal decision");same(decisions.find(v=>v?.success===false),failed(`Request already ${final.status}`));
 same((await receipt(firstUse,"friend-invite.use",f.tokens.b)).result,first);same((await receipt(firstUse,"friend-invite.use",f.tokens.a)).status,"absent");await receipt(firstUse,"friend-invite.use",f.tokens.thread,403);
 const beforeDenied=await invite("DENY01"),invalid=id();await call("friend-invite.use",{code:"DENY01",user_id:f.actors.c},{token:f.tokens.b,requestId:invalid,status:400});same(await invite("DENY01"),beforeDenied);same((await receipt(invalid,"friend-invite.use",f.tokens.b)).status,"absent");
 await call("friend-invite.generate",{code_length:1},{status:400});await call("friendship.list",{user_id:f.actors.c},{status:400});await call("friend-request.accept",{request_id:0},{status:400});await call("friendship.timeline",{friend_id:f.actors.b,limit:-1},{status:400});
 await call("friend-invite.use",{code:"DENY01"},{token:f.tokens.read_only,status:403});await call("friendship.list",{},{token:f.tokens.thread,status:403});await call("friend-invite.use",{code:"DENY01"},{token:f.tokens.thread,status:403});await call("friendship.list",{},{token:"",status:401});same(await invite("DENY01"),beforeDenied);
 same(seen.size,9);console.log(JSON.stringify({result:"PASS",operations:9,assertions,fixture:"provider-free-isolated-restricted-roles",semantics:"original errors/labels/NULL/precision; invitation and ordered pair locks; rejected same-ID resend; approve-reject concurrency; authorized pictures; immutable original receipt/audit"}));
}finally{await verification.end();const g=globalThis as typeof globalThis&{__ink_auth_pool?:{end():Promise<void>};__ink_dream_data_pool?:{end():Promise<void>}};await g.__ink_auth_pool?.end();await g.__ink_dream_data_pool?.end();}
