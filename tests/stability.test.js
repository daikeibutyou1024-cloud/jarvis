import test from 'node:test';
import assert from 'node:assert/strict';
import { testDB,budgetEnv } from './runtime-fixture.js';
import { runAI,aiConfig,recoverAI } from '../lib/ai-runtime.js';
import { saveRevision,revisionOf } from '../lib/documents.js';
import { saveLocalDraft } from '../lib/local-drafts.js';
import * as paid from '../functions/api/business/paid-drafts.js';
import * as drafts from '../functions/api/business/drafts.js';
import * as usage from '../functions/api/business/usage.js';
import * as jobs from '../functions/api/business/jobs.js';
import { onRequestPost as chat } from '../functions/api/chat.js';
import { onRequestPost as ideas } from '../functions/api/research/ideas.js';
import { article,evidence } from './paid-fixture.js';
const env=db=>({...budgetEnv,JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',ANTHROPIC_API_KEY:'fake'});
const req=(body,url='http://localhost/api')=>new Request(url,{method:'POST',headers:{'x-jarvis-password':'test','content-type':'application/json'},body:JSON.stringify(body)});
const good=(text='原稿')=>Response.json({stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5},content:[{type:'text',text}]});
async function mock(fn,work){const old=fetch;globalThis.fetch=fn;try{return await work();}finally{globalThis.fetch=old;}}
test('no unconfigured model, zero/invalid budget, or unknown provider can spend',async()=>{
 const db=testDB();let calls=0;
 await mock(()=>{calls++;throw Error();},async()=>{
  for(const patch of [{AI_MONTHLY_BUDGET_USD:undefined},{AI_MONTHLY_BUDGET_USD:'0'},{AI_MONTHLY_BUDGET_USD:'-1'},{AI_PRICING_JSON:'{}'},{ANTHROPIC_MODEL:'unknown'},{AI_PROVIDER:'other'}])await assert.rejects(runAI({...env(db),...patch},'chat','x',10));
 });assert.equal(calls,0);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='ai_usage'").get().n,0);db.db.close();
});
test('atomic concurrent reservations include running calls and settlement releases only measured difference',async()=>{
 const db=testDB();const e={...env(db),AI_MONTHLY_BUDGET_USD:'0.002',AI_PRICING_JSON:JSON.stringify({'anthropic/claude-sonnet-4-6':{input:1,output:1}})};
 let release,started;const ready=new Promise(r=>started=r);let calls=0;
 await mock(()=>{calls++;started();return new Promise(r=>release=r);},async()=>{
  const first=runAI(e,'chat','x',10);await ready;
  await assert.rejects(runAI(e,'chat','x',10),x=>x.code==='AI_BUDGET_EXCEEDED');assert.equal(calls,1);
  release(good());await first;
 });
 assert.equal(db.db.prepare('SELECT SUM(charged_micro) n FROM ai_operations').get().n,15);
 await mock(async()=>good(),()=>runAI(e,'chat','x',10));db.db.close();
});
test('quota denial refunds unused money reservation but never sends API request',async()=>{
 const db=testDB();const {reserveAI}=await import('../lib/ai-quota.js');for(let i=0;i<10;i++)await reserveAI(env(db),'chat');let calls=0;
 await mock(()=>{calls++;},async()=>{await assert.rejects(runAI(env(db),'chat','x',10),x=>x.code==='AI_QUOTA');});
 assert.equal(calls,0);assert.deepEqual({...db.db.prepare('SELECT state,charged_micro FROM ai_operations').get()},{state:'cancelled',charged_micro:0});db.db.close();
});
test('timeouts cover stalled body, retain reserved money, and never retry or accept late replies',async()=>{
 const db=testDB();let calls=0,signal,release;
 await mock(async(_url,o)=>{calls++;signal=o.signal;return {ok:true,json:()=>new Promise(r=>release=r)};},async()=>{
  await assert.rejects(runAI({...env(db),AI_TIMEOUT_MS:'15'},'chat','x',10),x=>x.code==='AI_TIMEOUT');
  assert.equal(signal.aborted,true);release(await good().json());await new Promise(r=>setTimeout(r,1));
 });const row=db.db.prepare('SELECT * FROM ai_operations').get();assert.equal(calls,1);assert.equal(row.state,'uncertain');assert.equal(row.charged_micro,row.reserved_micro);db.db.close();
});
test('HTTP failures and missing usage keep conservative reservations without leaking provider errors',async()=>{
 const db=testDB();await mock(async()=>Response.json({error:{message:'SECRET'}},{status:500}),async()=>{await assert.rejects(runAI(env(db),'chat','x',10),e=>e.code==='AI_UPSTREAM'&&!e.message.includes('SECRET'));});
 await mock(async()=>Response.json({content:[{type:'text',text:'x'}]}),()=>runAI(env(db),'chat','x',10));
 assert.equal(db.db.prepare("SELECT COUNT(*) n FROM ai_operations WHERE state='uncertain' AND charged_micro=reserved_micro").get().n,2);db.db.close();
});
test('interrupted jobs are marked failed on access, money is retained, and requests are not reissued',async()=>{
 const db=testDB();await recoverAI(db);
 db.db.prepare("INSERT INTO business_jobs(id,job_type,topic,status,created_at) VALUES('abandoned','content_draft','x','running',datetime('now','-5 minutes'))").run();
 const now=Date.now();db.db.prepare("INSERT INTO ai_operations(id,purpose,job_id,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at) VALUES('op','job','abandoned','anthropic','m',?,'running',100,100,1,1,?,?)").run(new Date().toISOString().slice(0,7),now-60000,now-1);
 await mock(()=>{throw Error('no fetch');},()=>jobs.recoverJobs(db));assert.equal(db.db.prepare('SELECT state FROM ai_operations').get().state,'interrupted');assert.equal(db.db.prepare('SELECT charged_micro FROM ai_operations').get().charged_micro,100);assert.equal(db.db.prepare('SELECT status FROM business_jobs').get().status,'failed');db.db.close();
});
test('unknown prior-month billing blocks new calls until explicit authenticated reconciliation',async()=>{
 const db=testDB();await mock(async()=>Response.json({content:[{type:'text',text:'x'}]}),()=>runAI(env(db),'chat','x',10));
 db.db.prepare("UPDATE ai_operations SET month='2000-01'").run();
 await assert.rejects(runAI(env(db),'chat','x',10),e=>e.code==='AI_BUDGET_EXCEEDED');
 const id=db.db.prepare('SELECT id FROM ai_operations').get().id;
 const bad=await usage.onRequestPost({env:env(db),request:req({id,chargedMicroUSD:0,note:'確認',confirmed:false})});assert.equal(bad.status,400);
 const ok=await usage.onRequestPost({env:env(db),request:req({id,chargedMicroUSD:0,note:'請求履歴で未課金を確認',confirmed:true})});assert.equal(ok.status,200);
 await mock(async()=>good(),()=>runAI(env(db),'chat','x',10));db.db.close();
});
test('stale simultaneous saves have exactly one winner and keep immutable history',async()=>{
 const db=testDB();await saveRevision(db,'case',0,{output:'original'});
 const results=await Promise.allSettled([saveRevision(db,'case',1,{output:'a'}),saveRevision(db,'case',1,{output:'b'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal(await revisionOf(db,'case'),2);assert.equal(JSON.parse(db.db.prepare("SELECT payload FROM document_revisions WHERE project_id='case' AND revision=1").get().payload).output,'original');db.db.close();
});
test('a failed legacy mirror rolls the revision back atomically',async()=>{
 const db=testDB();await assert.rejects(saveRevision(db,'case',0,{output:'x'},()=>db.prepare('INSERT INTO missing_table VALUES(1)')));assert.equal(await revisionOf(db,'case'),0);db.db.close();
});
test('legacy paid drafts are readable and archived before first versioned update; stale clients cannot overwrite',async()=>{
 const db=testDB();db.db.exec('CREATE TABLE paid_content_drafts (id TEXT PRIMARY KEY, topic TEXT, output TEXT, generation_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');db.db.prepare('INSERT INTO paid_content_drafts(id,topic,output,generation_json) VALUES(?,?,?,?)').run('legacy','旧記事','old text','{}');
 const b={id:'legacy',topic:'記事',text:article,evidence,manualComplete:true};
 let r=await paid.onRequestPost({env:env(db),request:req(b)});assert.equal(r.status,409);
 r=await paid.onRequestPost({env:env(db),request:req({...b,expectedRevision:0})});assert.equal(r.status,201);assert.equal((await r.json()).generation.document.revision,1);
 assert.equal(JSON.parse(db.db.prepare("SELECT payload FROM document_revisions WHERE project_id='legacy' AND revision=0").get().payload).output,'old text');
 r=await paid.onRequestPost({env:env(db),request:req({...b,text:'stale',expectedRevision:0})});assert.equal(r.status,409);assert.match(db.db.prepare('SELECT output FROM paid_content_drafts').get().output,/#/);db.db.close();
});
test('general drafts save without AI, list versions, and reject stale writes',async()=>{
 const db=testDB(),b={projectId:'free',department:'content',topic:'無料記事',text:'原稿',evidence:'',expectedRevision:0};
 await mock(()=>{throw Error('no AI');},async()=>{
  const r=await drafts.onRequestPost({env:env(db),request:req(b)});assert.equal(r.status,201);
  assert.equal((await drafts.onRequestPost({env:env(db),request:req(b)})).status,409);
  const list=await drafts.onRequestGet({env:env(db),request:new Request('http://localhost/api?projectId=free',{headers:{'x-jarvis-password':'test'}})});assert.equal((await list.json()).revisions.length,1);
 });db.db.close();
});
test('generation checks stale revision before AI and preserves a late conflicting result for manual recovery',async()=>{
 const db=testDB(),e=env(db),b={projectId:'case',expectedRevision:0,department:'marketing',topic:'案'};
 await mock(async()=>{await saveRevision(db,'case',0,{output:'another tab'});return good('生成した原稿');},async()=>{
  const r=await jobs.onRequestPost({env:e,request:req(b)});assert.equal(r.status,409);const d=await r.json();assert.equal(d.recovery.output,'生成した原稿');
 });
 let calls=0;await mock(()=>{calls++;},async()=>{assert.equal((await jobs.onRequestPost({env:e,request:req(b)})).status,409);});assert.equal(calls,0);assert.equal(await revisionOf(db,'case'),1);db.db.close();
});
test('local tab saves keep legacy rows, serialize versions, and reject stale editors',async()=>{
 let data=JSON.stringify([{text:'legacy'}]);const storage={getItem:()=>data,setItem:(_key,v)=>data=v};let chain=Promise.resolve();const locks={request:(_key,fn)=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;}};
 const entry={document:{projectId:'case',revision:0},text:'new'};
 const results=await Promise.allSettled([saveLocalDraft(storage,locks,'key',entry,0),saveLocalDraft(storage,locks,'key',entry,0)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(JSON.parse(data).at(-1).text,'legacy');await assert.rejects(saveLocalDraft(storage,null,'key',entry,1));
});
test('all AI endpoint implementations use the same gateway and the workflow contains no API client',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const p of ['functions/api/chat.js','functions/api/business/jobs.js','functions/api/research/ideas.js']){const text=readFileSync(new URL('../'+p,import.meta.url),'utf8');assert.match(text,/runAI\(/);assert.doesNotMatch(text,/fetch\(|api\.anthropic\.com|api\.openai\.com/);}
 assert.doesNotMatch(readFileSync(new URL('../.github/workflows/jarvis.yml',import.meta.url),'utf8'),/ANTHROPIC_API_KEY|urllib|api\.anthropic/);
});
test('opening monthly spend is included and invalid opening configuration cannot spend',async()=>{
 const db=testDB(),month=new Date().toISOString().slice(0,7),e={...env(db),AI_MONTHLY_BUDGET_USD:'1',AI_OPENING_SPEND_USD_JSON:JSON.stringify({[month]:'1'})};
 await assert.rejects(runAI(e,'chat','x',10),x=>x.code==='AI_BUDGET_EXCEEDED');
 assert.throws(()=>aiConfig({...e,AI_OPENING_SPEND_USD_JSON:JSON.stringify({[month]:-1})},'x',10));db.db.close();
});
test('reported cost beyond reservation halts subsequent calls until human reconciliation',async()=>{
 const db=testDB();await mock(async()=>Response.json({content:[{type:'text',text:'x'}],usage:{input_tokens:1000000,output_tokens:1000000}}),()=>runAI(env(db),'chat','x',10));
 assert.equal(db.db.prepare('SELECT state FROM ai_operations').get().state,'overrun');await assert.rejects(runAI(env(db),'chat','x',10),e=>e.code==='AI_BUDGET_EXCEEDED');db.db.close();
});
test('invalid auth cannot read money, save history, or reconcile charges',async()=>{
 const db=testDB();for(const api of [paid,drafts,usage])for(const method of ['onRequestGet','onRequestPost']){
  const r=await api[method]({env:env(db),request:new Request('http://localhost/api',{method:method.endsWith('Post')?'POST':'GET'})});assert.equal(r.status,401);
 }assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('document_revisions','ai_operations')").get().n,0);db.db.close();
});
test('runtime additive table definitions agree with the optional migration',async()=>{
 const {readFileSync}=await import('node:fs');const a=testDB(),b=testDB();await recoverAI(a);await revisionOf(a,'x');b.db.exec(readFileSync(new URL('../migrations/0005_stability.sql',import.meta.url),'utf8'));
 for(const table of ['document_revisions','ai_operations'])assert.deepEqual(a.db.prepare(`PRAGMA table_info(${table})`).all(),b.db.prepare(`PRAGMA table_info(${table})`).all());a.db.close();b.db.close();
});
