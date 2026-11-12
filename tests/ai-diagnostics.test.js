import test from 'node:test';
import assert from 'node:assert/strict';
import {runAI,aiFailure} from '../lib/ai-runtime.js';
import {testDB,budgetEnv} from './runtime-fixture.js';
import {createDiagnostic} from '../lib/ai-diagnostics.js';
import {spokenText} from '../lib/speech.js';
test('speech preserves ordinary text and removes emoji, flags, keycaps and formatting',()=>{
 assert.equal(spokenText('Preview test 123 日本語 😊 🇯🇵 👩🏽‍💻 1️⃣'), 'Preview test 123 日本語');
 assert.equal(spokenText('## ABC\n日本語 https://example.com'), 'ABC 日本語 リンク');
});
test('diagnostic logging failure never interrupts work',()=>{const original=console.info;console.info=()=>{throw Error('logger down');};try{const d=createDiagnostic();d.stage('quota');assert.match(d.finish().id,/^[a-f0-9-]{36}$/);}finally{console.info=original;}});
for(const scenario of ['headers_timeout','body_timeout','upstream','invalid_json','success'])test('offline diagnostic: '+scenario,async()=>{
 const db=testDB(),original=fetch,log=console.info,logs=[];let calls=0;
 console.info=s=>logs.push(JSON.parse(s));
 globalThis.fetch=async()=>{calls++;
 if(scenario==='headers_timeout')return new Promise(()=>{});
 if(scenario==='body_timeout')return {ok:true,status:200,headers:new Headers({'request-id':'req_safe'}),json:()=>new Promise(()=>{})};
 if(scenario==='upstream')return new Response('SECRET_PROVIDER_BODY',{status:429,headers:{'request-id':'SECRET bad id'}});
 if(scenario==='invalid_json')return new Response('SECRET_PROVIDER_BODY');
 return Response.json({stop_reason:'end_turn',usage:{input_tokens:5,output_tokens:5},content:[{type:'text',text:'本文'}]},{headers:{'request-id':'req_safe'}});
 };
 try{
 const promise=runAI({...budgetEnv,JARVIS_DB:db,ANTHROPIC_API_KEY:'SECRET_KEY',AI_TIMEOUT_MS:'15'},'job','SECRET_PROMPT',2500);
 if(scenario==='success'){const r=await promise;assert(r.generation.diagnostic.id);assert.equal(r.text,'本文');}
 else{await assert.rejects(promise,e=>{const d=aiFailure(e);assert(d.diagnostic.id);assert.equal(e.code,scenario.endsWith('timeout')?'AI_TIMEOUT':scenario==='upstream'?'AI_UPSTREAM':'AI_RESPONSE_INVALID');if(scenario.endsWith('timeout'))assert.equal(d.diagnostic.stage,scenario==='headers_timeout'?'provider_headers':'provider_body');return true;});}
 assert.equal(calls,1);assert(!JSON.stringify(logs).includes('SECRET'));
 const op=db.db.prepare('SELECT * FROM ai_operations').get();assert.equal(op.state,scenario==='success'?'completed':'uncertain');if(scenario!=='success')assert.equal(op.charged_micro,op.reserved_micro);
 assert(logs.some(x=>x.stage==='quota'));if(scenario==='upstream')assert(logs.some(x=>x.httpStatus===429));
 }finally{globalThis.fetch=original;console.info=log;db.db.close();}
});
