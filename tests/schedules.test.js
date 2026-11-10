import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './runtime-fixture.js';
import {saveSchedule,runDueCollection,recoverCollections,initSchedules,SCHEDULE_SCHEMA} from '../lib/schedules.js';
import * as settings from '../functions/api/business/schedules.js';
import * as tick from '../functions/api/business/tick.js';
import * as report from '../functions/api/business/report.js';
import {japanDay,operationalReport} from '../lib/operational-report.js';
import worker,{relay} from '../workers/collector.js';
const now=Date.parse('2026-11-11T03:00:00Z');
const env=db=>({JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',JARVIS_SCHEDULER_TOKEN:'x'.repeat(40),COLLECTION_AUTOMATION_ENABLED:'true'});
const input=(extra={})=>({id:'daily',name:'公開情報を調べる',source:'digital',query:'AI',intervalMinutes:60,enabled:true,expectedVersion:0,...extra});
const req=(body,password='test')=>new Request('http://localhost/api',{method:'POST',headers:{'x-jarvis-password':password,'content-type':'application/json'},body:JSON.stringify(body)});
const record=(text='AIの公式情報')=>({title:'AIの公式発表',text,sourceUrl:'https://www.digital.go.jp/news/example',origin:'digital',fetchedAt:new Date(now).toISOString(),publishedAt:'2026-11-10',kind:'fact',verification:'source_observed',status:'acquired',reviewedAt:'forged-reviewed',price:'10000',affiliate:'fake'});
const result=(items=[record()])=>({status:'acquired',items,cached:false,fetchedAt:new Date(now).toISOString()});
async function noNetwork(fn){const old=fetch;globalThis.fetch=()=>{throw Error('Real network forbidden');};try{return await fn();}finally{globalThis.fetch=old;}}
test('unauthenticated and globally stopped ticks cannot initialize tables or fetch',async()=>noNetwork(async()=>{
 const db=testDB();let r=await tick.onRequestPost({env:env(db),request:req({})});assert.equal(r.status,401);
 r=await tick.onRequestPost({env:{...env(db),COLLECTION_AUTOMATION_ENABLED:'false'},request:new Request('http://localhost/api',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(40)},body:'{}'})});assert.equal(r.status,503);
 assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='collection_runs'").get().n,0);db.db.close();
}));
test('source, query, interval, version and schedule-count guards reject unsafe changes',async()=>noNetwork(async()=>{
 const db=testDB();for(const patch of [{source:'https://evil.example'},{query:'x repo:private'},{intervalMinutes:1},{intervalMinutes:1441},{enabled:'true'},{expectedVersion:-1}])await assert.rejects(saveSchedule(db,input(patch),now));
 const s=await saveSchedule(db,input(),now);assert.equal(s.version,1);assert.equal((await saveSchedule(db,input({expectedVersion:1,enabled:false}),now)).version,2);
 await assert.rejects(saveSchedule(db,input({expectedVersion:1}),now),e=>e.status===409);
 for(let i=1;i<10;i++)await saveSchedule(db,input({id:'config-'+i}),now);
 await assert.rejects(saveSchedule(db,input({id:'eleventh'}),now),e=>e.status===409);db.db.close();
}));
test('concurrent ticks claim one run and unchanged data is not imported repeatedly',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);let calls=0,release,started;const ready=new Promise(r=>started=r);
 const first=runDueCollection(env(db),{clock:()=>now,collectOnce:()=>{calls++;started();return new Promise(r=>release=r);}});await ready;
 const second=await runDueCollection(env(db),{clock:()=>now,collectOnce:()=>{calls++;return result();}});assert.ok(['idle','blocked'].includes(second.state));release(result());assert.equal((await first).inserted,1);assert.equal(calls,1);
 const again=await runDueCollection(env(db),{clock:()=>now+3600000,collectOnce:async()=>result()});assert.equal(again.inserted,0);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,1);
 const saved=JSON.parse(db.db.prepare('SELECT record_json FROM research_inbox').get().record_json);assert.equal(saved.reviewedAt,null);assert.equal(saved.price,'');assert.equal(saved.affiliate,'');assert.equal(saved.verification,'source_observed');db.db.close();
}));
test('the next real scheduled slot may collect new content but no missed-slot replay occurs',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);
 await runDueCollection(env(db),{clock:()=>now+10*3600000,collectOnce:async()=>result()});assert.equal(db.db.prepare('SELECT next_run_at n FROM collection_schedules').get().n,now+11*3600000);
 assert.equal((await runDueCollection(env(db),{clock:()=>now+10*3600000,collectOnce:()=>{throw Error('no replay');}})).state,'idle');
 await runDueCollection(env(db),{clock:()=>now+11*3600000,collectOnce:async()=>result([record('更新されたAI情報')])});assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,2);db.db.close();
}));
test('daily execution cap includes failures and prevents any extra collection',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);let calls=0;
 const e={...env(db),COLLECTION_DAILY_LIMIT:'1'};
 const first=await runDueCollection(e,{clock:()=>now,collectOnce:()=>{calls++;throw Error('provider secret should not leak');}});assert.equal(first.state,'failed');assert.doesNotMatch(JSON.stringify(first),/provider secret/);
 const later=await runDueCollection(e,{clock:()=>now+3600000,collectOnce:()=>{calls++;return result();}});assert.equal(later.state,'blocked');assert.equal(calls,1);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM collection_runs').get().n,1);db.db.close();
}));
test('a mid-flight disable discards the result, without changing earlier inbox data',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);
 const r=await runDueCollection(env(db),{clock:()=>now,collectOnce:async()=>{await saveSchedule(db,input({enabled:false,expectedVersion:1}),now+1);return result();}});
 assert.equal(r.state,'cancelled');assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,0);assert.equal(db.db.prepare('SELECT state FROM collection_runs').get().state,'cancelled');db.db.close();
}));
test('expired in-flight responses cannot insert records even before a recovery sweep',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);let time=now;
 const r=await runDueCollection(env(db),{clock:()=>time,collectOnce:async()=>{time+=31000;return result();}});assert.equal(r.state,'cancelled');assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,0);db.db.close();
}));
test('process interruption is recorded and that same slot is never restarted',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);await initSchedules(db);
 db.db.prepare("INSERT INTO collection_runs(id,schedule_id,schedule_version,due_at,state,started_at,expires_at) VALUES('dead','daily',1,?,'running',?,?)").run(now,now,now+1000);db.db.prepare('UPDATE collection_schedules SET next_run_at=?').run(now+3600000);
 await recoverCollections(db,now+2000);assert.equal(db.db.prepare('SELECT state FROM collection_runs').get().state,'interrupted');assert.equal((await runDueCollection(env(db),{clock:()=>now+2000,collectOnce:()=>{throw Error('no retry');}})).state,'idle');db.db.close();
}));
test('storage capacity stops new network attempts and a full batch never overwrites prior records',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);const stmt=db.db.prepare("INSERT INTO research_inbox(id,source,source_url,fingerprint,record_json,run_id,state,created_at) VALUES(?,'digital',?,?,'{}','old','new',?)");for(let i=0;i<500;i++)stmt.run('old'+i,'https://example.com/'+i,String(i),now);
 let calls=0;const r=await runDueCollection(env(db),{clock:()=>now,collectOnce:()=>{calls++;return result();}});assert.equal(r.state,'blocked');assert.equal(calls,0);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,500);db.db.close();
}));
test('settings and inbox acknowledgement are authenticated and do not mark facts reviewed',async()=>noNetwork(async()=>{
 const db=testDB();assert.equal((await settings.onRequestPost({env:env(db),request:req({...input(),action:'save'},'wrong')})).status,401);
 assert.equal((await settings.onRequestPost({env:env(db),request:req({...input({enabled:false}),action:'save'})})).status,201);
 await saveSchedule(db,input({expectedVersion:1}),now);await runDueCollection(env(db),{clock:()=>now,collectOnce:async()=>result()});const row=db.db.prepare('SELECT id,record_json FROM research_inbox').get();
 const r=await settings.onRequestPost({env:env(db),request:req({action:'ack',ids:[row.id]})});assert.equal(r.status,200);assert.equal(db.db.prepare('SELECT state FROM research_inbox').get().state,'imported');assert.equal(JSON.parse(db.db.prepare('SELECT record_json FROM research_inbox').get().record_json).reviewedAt,null);db.db.close();
}));
test('the real collection path keeps existing limits, caches and never calls an AI endpoint',async()=>{
 const db=testDB();await saveSchedule(db,input({source:'github',query:'AI'}),Date.now());const old=fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(String(url),/^https:\/\/api.github.com\/search\/repositories/);assert.equal(options.headers['x-jarvis-password'],undefined);return Response.json({items:[{full_name:'owner/AI',description:'AI project',html_url:'https://github.com/owner/AI',updated_at:'2026-11-11T00:00:00Z'}]});};
 try{const r=await runDueCollection(env(db));assert.equal(r.state,'completed');assert.equal(calls,1);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='ai_usage'").get().n,0);}finally{globalThis.fetch=old;db.db.close();}
});
test('JST report uses the actual date window and never fills missing sales or costs with invented zeros',async()=>noNetwork(async()=>{
 const db=testDB();const empty=await operationalReport(db,'2026-11-11');assert.equal(empty.ai,null);assert.equal(empty.revenue,null);assert.equal(empty.profit,null);
 await saveSchedule(db,input(),now);await runDueCollection(env(db),{clock:()=>now,collectOnce:async()=>result()});const d=await operationalReport(db,'2026-11-11');assert.equal(d.collection.attempts,1);assert.equal(d.inbox.acquiredToday,1);assert.equal(d.inbox.pending,1);assert.equal(d.periodStart,'2026-11-10T15:00:00.000Z');assert.equal(d.periodEnd,'2026-11-11T15:00:00.000Z');assert.equal(d.ai,null);assert.throws(()=>japanDay('2026-02-30'));db.db.close();
}));
test('report endpoint is authenticated and rejects invalid date input without writes',async()=>noNetwork(async()=>{
 const db=testDB();assert.equal((await report.onRequestGet({env:env(db),request:new Request('http://localhost/api')})).status,401);assert.equal((await report.onRequestGet({env:env(db),request:new Request('http://localhost/api?date=bad',{headers:{'x-jarvis-password':'test'}})})).status,400);db.db.close();
}));
test('relay stays off by default, targets only Preview, refuses redirects and never retries',async()=>{
 const old=fetch;let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://feature-ai-business-rebuild.asset-simulator-87y.pages.dev/api/business/tick');assert.equal(options.redirect,'error');return Response.json({state:'completed'});};
 try{assert.equal((await relay({})).state,'disabled');assert.equal(calls,0);assert.equal((await relay({COLLECTOR_RELAY_ENABLED:'true',JARVIS_SCHEDULER_TOKEN:'x'.repeat(40)})).state,'completed');assert.equal(calls,1);let retryDisabled=false;await worker.scheduled({noRetry(){retryDisabled=true;}},{});assert.equal(retryDisabled,true);assert.equal(calls,1);
 globalThis.fetch=async()=>{calls++;throw Error('no network');};await assert.rejects(relay({COLLECTOR_RELAY_ENABLED:'true',JARVIS_SCHEDULER_TOKEN:'x'.repeat(40)}));assert.equal(calls,2);
 }finally{globalThis.fetch=old;}
});
test('capacity reached inside a batch is reported with the number actually stored',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);const s=db.db.prepare("INSERT INTO research_inbox(id,source,source_url,fingerprint,record_json,run_id,state,created_at) VALUES(?,'digital',?,?,'{}','old','new',?)");for(let i=0;i<499;i++)s.run('old'+i,'https://example.com/'+i,String(i),now);
 const a=record(),b={...record('別資料'),sourceUrl:'https://www.digital.go.jp/news/another'};const r=await runDueCollection(env(db),{clock:()=>now,collectOnce:async()=>result([a,b])});assert.equal(r.inserted,1);const run=db.db.prepare('SELECT state,result_json FROM collection_runs').get();assert.equal(run.state,'completed_capacity');assert.equal(JSON.parse(run.result_json).inserted,1);assert.equal(JSON.parse(run.result_json).acquired,2);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,500);db.db.close();
}));
test('a storage failure rolls both inbox writes and completion back without changing previous records',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);db.db.exec("CREATE TRIGGER fail_inbox BEFORE INSERT ON research_inbox BEGIN SELECT RAISE(ABORT,'simulated database failure'); END;");const r=await runDueCollection(env(db),{clock:()=>now,collectOnce:async()=>result()});assert.equal(r.state,'failed');assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,0);assert.equal(db.db.prepare('SELECT state FROM collection_runs').get().state,'failed');db.db.close();
}));
test('unknown or invalid collector data is not recorded as a completed collection',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);const r=await runDueCollection(env(db),{clock:()=>now,collectOnce:async()=>result([{...record(),sourceUrl:'http://127.0.0.1'}])});assert.equal(r.state,'failed');assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,0);db.db.close();
}));
test('a stalled collection is interrupted once and a late result cannot reach the inbox',async()=>noNetwork(async()=>{
 const db=testDB();await saveSchedule(db,input(),now);let release,calls=0;
 const r=await runDueCollection(env(db),{clock:()=>now,timeoutMs:15,collectOnce:()=>{calls++;return new Promise(resolve=>release=resolve);}});assert.equal(r.state,'interrupted');release(result());await new Promise(resolve=>setTimeout(resolve,1));assert.equal(calls,1);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM research_inbox').get().n,0);assert.equal(db.db.prepare('SELECT state FROM collection_runs').get().state,'interrupted');db.db.close();
}));
test('receiver clears forged review and commercial fields, keeps duplicate reviews, and refuses ID collisions',async()=>{
 const {receivedRecord}=await import('../assets/research-data.js');const r={...record(),id:'record-1'};const clean=receivedRecord(r);assert.equal(clean.reviewedAt,null);assert.equal(clean.price,'');const reviewed={...clean,reviewedAt:'2026-11-11T03:00:00Z',bodyText:'確認した本文'};assert.deepEqual(receivedRecord(r,[reviewed]),reviewed);assert.throws(()=>receivedRecord({...r,text:'別の内容'},[reviewed]));assert.throws(()=>receivedRecord({...r,sourceUrl:'javascript:alert(1)'}));
});
test('JST cost reporting includes only the selected window and preserves unverified currency amounts',async()=>noNetwork(async()=>{
 const db=testDB();const {initAI}=await import('../lib/ai-runtime.js');await initAI(db);const {start,end}=japanDay('2026-11-11');const s=db.db.prepare("INSERT INTO ai_operations(id,purpose,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at) VALUES(?,'chat','anthropic','fake','2026-11',?,100,?,1,1,?,?)");s.run('inside','uncertain',100,start,start+1);s.run('inside2','completed',25,end-1,end);s.run('before','completed',999,start-1,start);s.run('after','completed',999,end,end+1);const r=await operationalReport(db,'2026-11-11');assert.equal(r.ai.attempts,2);assert.equal(r.ai.committedMicroUSD,125);assert.equal(r.ai.unresolved,1);assert.equal(r.ai.currency,'USD');assert.equal(r.ai.invoiceVerified,false);assert.equal(r.revenue,null);db.db.close();
}));
test('current editorial stages can be reported without generating any new drafts',async()=>noNetwork(async()=>{
 const db=testDB(),e=env(db);const editor=await import('../functions/api/business/editorial.js');const {article,evidence}=await import('./paid-fixture.js');const {defaultOutline,REVIEW_CHECKS}=await import('../lib/editorial.js');
 const b={action:'save',projectId:'report-project',expectedRevision:0,topic:'業務整理',audience:'初心者',notes:'',format:'note有料記事',text:article,evidence,manualComplete:true,workflow:{idea:'記入例と手順を渡す',outline:defaultOutline('note有料記事'),noExternalFacts:false}};assert.equal((await editor.onRequestPost({env:e,request:req(b)})).status,201);let r=await operationalReport(db,'2026-11-11');assert.equal(r.editorial.counts.review_pending,1);
 await editor.onRequestPost({env:e,request:req({action:'approve',projectId:'report-project',expectedRevision:1,checks:Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]))})});r=await operationalReport(db,'2026-11-11');assert.equal(r.editorial.counts.review_recorded,1);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM document_revisions').get().n,1);db.db.close();
}));
test('optional schedule migration matches runtime and does not alter existing job tables',async()=>noNetwork(async()=>{
 const {readFileSync}=await import('node:fs');const a=testDB(),b=testDB();await initSchedules(a);b.db.exec(readFileSync(new URL('../migrations/0007_collection_schedules.sql',import.meta.url),'utf8'));for(const table of ['collection_schedules','collection_runs','research_inbox','business_jobs'])assert.deepEqual(a.db.prepare(`PRAGMA table_info(${table})`).all(),b.db.prepare(`PRAGMA table_info(${table})`).all());a.db.close();b.db.close();
}));
