import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testDB,budgetEnv} from './runtime-fixture.js';
import {initAI,aiConfig,runAI} from '../lib/ai-runtime.js';
import {reconcileAI,initReconciliations,RECONCILIATION_SCHEMA} from '../lib/ai-reconciliation.js';
import {usdMicro,openingMicro} from '../lib/ai-money.js';
import * as api from '../functions/api/business/usage.js';
const env=db=>({...budgetEnv,JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',ANTHROPIC_API_KEY:'fixture'});
const req=b=>new Request('http://localhost/api/business/usage',{method:'POST',headers:{'x-jarvis-password':'test'},body:JSON.stringify(b)});
const input=(extra={})=>({id:'op',chargedMicroUSD:123456,note:'請求履歴で確認',confirmed:true,expectedState:'uncertain',expectedChargedMicroUSD:500000,...extra});
const tokens=JSON.stringify({input_tokens:100,output_tokens:20,cache_creation_input_tokens:5});
async function setup(){const db=testDB();await initAI(db);db.db.prepare("INSERT INTO ai_operations(id,purpose,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at,finished_at,usage_json) VALUES('op','chat','anthropic','fixture',?,'uncertain',500000,500000,3,15,1,2,3,?)").run(new Date().toISOString().slice(0,7),tokens);return db;}
test('USD parser uses exact millionths and rejects empty, fractional-micro, negative and non-string amounts',()=>{
 assert.equal(usdMicro('0.000001'),1);assert.equal(usdMicro('0.100001'),100001);assert.equal(usdMicro('1000000'),1e12);assert.equal(usdMicro('0'),0);
 for(const v of ['',null,undefined,0,false,'-1','1e-6','1,000','0.0000001','1000001','Infinity','NaN'])assert.throws(()=>usdMicro(v));
});
test('explicit invalid opening balances never turn into zero or authorize a provider call',async()=>{
 const db=testDB(),month=new Date().toISOString().slice(0,7);
 for(const value of [0,false,null,'',-1,[],{}]){const e={...env(db),AI_OPENING_SPEND_USD_JSON:JSON.stringify({[month]:value})};assert.throws(()=>aiConfig(e,'test',10),e=>e.code==='AI_BUDGET_CONFIG');await assert.rejects(runAI(e,'chat','test',10),e=>e.code==='AI_BUDGET_CONFIG');}
 for(const raw of ['null','[]','false','""','',JSON.stringify({'not-a-month':'0'}),JSON.stringify({'2026-13':'0'})])assert.throws(()=>openingMicro({AI_OPENING_SPEND_USD_JSON:raw},month));
 assert.equal(openingMicro({},month),0);assert.equal(openingMicro({AI_OPENING_SPEND_USD_JSON:'{}'},month),0);assert.equal(openingMicro({AI_OPENING_SPEND_USD_JSON:JSON.stringify({[month]:'0.000001'})},month),1);assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='ai_operations'").get(),undefined);db.db.close();
});
test('reconciliation preserves original usage and records the before/after state and note once',async()=>{
 const db=await setup();const r=await reconcileAI(db,input(),123);assert.equal(r.reconciled,true);assert.equal(r.alreadyReconciled,false);const op=db.db.prepare('SELECT * FROM ai_operations').get(),audit=db.db.prepare('SELECT * FROM ai_reconciliations').get();assert.equal(op.usage_json,tokens);assert.equal(op.state,'reconciled');assert.equal(op.charged_micro,123456);assert.equal(audit.prior_usage_json,tokens);assert.equal(audit.prior_state,'uncertain');assert.equal(audit.prior_charged_micro,500000);assert.equal(audit.charged_micro,123456);assert.equal(audit.note,input().note);assert.equal(audit.recorded_at,123);assert.equal(op.reserved_micro,500000);db.db.close();
});
test('lost-response retries are idempotent and changed amounts or notes cannot rewrite the audit',async()=>{
 const db=await setup();await reconcileAI(db,input(),123);assert.equal((await reconcileAI(db,input(),999)).alreadyReconciled,true);for(const b of [input({chargedMicroUSD:0}),input({note:'別の照合'})])await assert.rejects(reconcileAI(db,b),e=>e.status===409);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM ai_reconciliations').get().n,1);assert.equal(db.db.prepare('SELECT recorded_at FROM ai_reconciliations').get().recorded_at,123);db.db.close();
});
test('simultaneous conflicting reconciliations have one winner with matching ledger and audit',async()=>{
 const db=await setup();const results=await Promise.allSettled([reconcileAI(db,input()),reconcileAI(db,input({chargedMicroUSD:0}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);const op=db.db.prepare('SELECT * FROM ai_operations').get(),audit=db.db.prepare('SELECT * FROM ai_reconciliations').get();assert.equal(audit.charged_micro,op.charged_micro);assert.equal(op.usage_json,tokens);db.db.close();
});
test('failed audit write rolls the amount and state back and never destroys the original usage',async()=>{
 const db=await setup();await initReconciliations(db);db.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON ai_reconciliations BEGIN SELECT RAISE(ABORT,'simulated'); END;");await assert.rejects(reconcileAI(db,input()),e=>e.status===409);const op=db.db.prepare('SELECT * FROM ai_operations').get();assert.equal(op.state,'uncertain');assert.equal(op.charged_micro,500000);assert.equal(op.usage_json,tokens);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM ai_reconciliations').get().n,0);db.db.close();
});
test('snapshot mismatches and a change between preflight and commit cannot write a misleading audit',async()=>{
 const db=await setup();for(const patch of [{expectedState:'overrun'},{expectedChargedMicroUSD:1}])await assert.rejects(reconcileAI(db,input(patch)),e=>e.status===409);
 let changed=false;const wrapper={...db,async batch(ss){if(!changed){changed=true;db.db.prepare("UPDATE ai_operations SET usage_json='changed before commit'").run();}return db.batch(ss);}};await assert.rejects(reconcileAI(wrapper,input()),e=>e.status===409);assert.equal(db.db.prepare('SELECT state FROM ai_operations').get().state,'uncertain');assert.equal(db.db.prepare('SELECT COUNT(*) n FROM ai_reconciliations').get().n,0);db.db.close();
});
test('existing legacy reconciliations stay unchanged and new audit migration is additive and repeatable',async()=>{
 const db=await setup();const legacy=JSON.stringify({humanReconciliation:true,note:'旧確認'});db.db.prepare("UPDATE ai_operations SET state='reconciled',usage_json=?").run(legacy);const before=db.db.prepare('SELECT * FROM ai_operations').get();const sql=readFileSync(new URL('../migrations/0009_ai_reconciliations.sql',import.meta.url),'utf8');assert.ok(sql.includes(RECONCILIATION_SCHEMA));db.db.exec(sql);db.db.exec(sql);await assert.rejects(reconcileAI(db,input()),e=>e.status===409);assert.deepEqual(db.db.prepare('SELECT * FROM ai_operations').get(),before);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM ai_reconciliations').get().n,0);db.db.close();
});
test('history API exposes the new audit while retaining token usage and old request compatibility',async()=>{
 const db=await setup();const oldInput={id:'op',chargedMicroUSD:0,note:'課金なしを確認',confirmed:true};let r=await api.onRequestPost({env:env(db),request:req(oldInput)});assert.equal(r.status,200);assert.equal((await r.json()).alreadyReconciled,false);r=await api.onRequestGet({env:env(db),request:new Request('http://localhost/api/business/usage',{headers:{'x-jarvis-password':'test'}})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const data=await r.json();assert.equal(data.operations[0].usage_json,tokens);assert.equal(data.operations[0].reconciliation_note,oldInput.note);assert.equal(data.committedMicroUSD,0);assert.equal(data.openingUSD,'0.000000');db.db.close();
});
test('invalid or unauthenticated reconciliation cannot write, recover jobs or expose storage errors',async()=>{
 const trap={prepare(){throw Error('private-error');}};let r=await api.onRequestPost({env:env(trap),request:new Request('http://localhost',{method:'POST',body:'{}'})});assert.equal(r.status,401);
 for(const b of [null,{},input({confirmed:false}),input({note:''}),input({chargedMicroUSD:0.1})]){r=await api.onRequestPost({env:env(trap),request:req(b)});assert.equal(r.status,400);assert.ok(!(await r.text()).includes('private-error'));}
});
