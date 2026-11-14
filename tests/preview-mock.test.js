import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adaptDB} from './runtime-fixture.js';
import {manage,snapshot} from '../lib/preview-mock.js';
import {onRequestGet,onRequestPost} from '../functions/api/business/automation.js';
const schema=readFileSync(new URL('../migrations/0011_preview_mock_automation.sql',import.meta.url),'utf8');
function dbAt(path=':memory:'){const raw=new DatabaseSync(path);raw.exec(schema);return adaptDB(raw);}
async function act(db,action,extra={},options){const c=(await snapshot(db)).control;return manage(db,{action,expectedVersion:c.version,...extra},options);}
const at=(hour,day='2026-11-14')=>`${day}T${hour}:00+09:00`;
const tick=(db,step,hour,day)=>act(db,'tick',{step,at:at(hour,day)});
async function approve(db,kind){const i=(await snapshot(db)).items.find(i=>i.kind===kind);return act(db,'approve',{day:i.day,kind,itemVersion:i.version,confirmed:true});}
async function untilDraft(db){
 await act(db,'start');await tick(db,'collect','12:00');
 assert.equal((await tick(db,'themes','14:00')).state,'awaiting_approval');
 await approve(db,'sources');await tick(db,'themes','14:00');
 assert.equal((await tick(db,'content','16:00')).state,'awaiting_approval');
 await approve(db,'theme');await tick(db,'content','16:00');
}
test('durable full workflow survives reopening; approvals and original data remain separate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jarvis-mock-'));let db;
 try{
  const path=join(dir,'test.sqlite');db=dbAt(path);
  db.raw.exec("CREATE TABLE document_revisions(payload TEXT); INSERT INTO document_revisions VALUES('protected'); CREATE TABLE ai_operations(charged_micro INTEGER); INSERT INTO ai_operations VALUES(123)");
  assert.equal((await snapshot(db)).control.state,'stopped');
  await assert.rejects(tick(db,'collect','12:00'),/停止中/);
  await untilDraft(db);await act(db,'stop');db.raw.close();db=dbAt(path);
  assert.equal((await snapshot(db)).control.state,'stopped');
  await act(db,'start');await tick(db,'save','18:00');await tick(db,'report','19:30');
  const s=await snapshot(db),report=s.items.find(i=>i.kind==='daily_report').payload;
  assert.equal(s.runs.length,5);assert.ok(s.runs.every(r=>r.state==='completed'));
  assert.equal(report.savedDrafts,2);assert.equal(report.mockCalls,2);assert.equal(report.realCostUSD,0);
  assert.equal(report.actualRevenue,null);assert.equal(report.steps.at(-1).state,'completed');
  assert.equal(s.items.find(i=>i.kind==='saved_drafts').payload.humanReview,'pending');
  assert.equal(db.raw.prepare('SELECT payload FROM document_revisions').get().payload,'protected');
  assert.equal(db.raw.prepare('SELECT charged_micro FROM ai_operations').get().charged_micro,123);
  await assert.rejects(tick(db,'report','19:30'),/実行済み/);
 }finally{db?.raw.close();rmSync(dir,{recursive:true,force:true});}
});
test('concurrent claims, stale versions, duplicate delivery and approvals are fenced',async()=>{
 const db=dbAt();try{
  await act(db,'start');const version=(await snapshot(db)).control.version;
  const results=await Promise.allSettled([1,2].map(()=>manage(db,{action:'tick',expectedVersion:version,step:'collect',at:at('12:00')})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM automation_runs').get().n,1);
  await assert.rejects(manage(db,{action:'stop',expectedVersion:version}),/状態が変わり/);
  await assert.rejects(tick(db,'collect','12:00'),/実行済み/);
  await assert.rejects(act(db,'approve',{day:'2026-11-14',kind:'sources',itemVersion:999,confirmed:true}),/版が変わり/);
  await approve(db,'sources');await assert.rejects(approve(db,'sources'),/版が変わり/);
 }finally{db.raw.close();}
});
test('monotonic simulation time, day window, dependencies and mock budget cap',async()=>{
 const db=dbAt();try{
  await act(db,'start');await assert.rejects(tick(db,'content','16:00'),/前工程/);
  await assert.rejects(tick(db,'collect','11:59'),/開始時刻/);
  await assert.rejects(tick(db,'collect','20:00'),/開始時刻/);
  await assert.rejects(act(db,'tick',{step:'collect',at:'bad'}),/模擬時刻/);
  await tick(db,'collect','12:00');await approve(db,'sources');
  await assert.rejects(act(db,'tick',{step:'themes',at:at('14:00')},{budgetUSD:'1.000001'}),/上限/);
  await assert.rejects(act(db,'tick',{step:'themes',at:at('14:00')},{budgetUSD:'0'}),/予算上限/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM automation_runs').get().n,1);
  await tick(db,'themes','14:00');await assert.rejects(tick(db,'collect','12:00'),/巻き戻せ/);
  await assert.rejects(act(db,'start',{url:'https://example.com'}),/入力項目/);
 }finally{db.raw.close();}
});
test('manual stop during an in-flight claim discards the late result atomically',async()=>{
 const db=dbAt();try{
  await act(db,'start');const original=db.batch.bind(db);let stopAfterClaim=true;
  db.batch=async ss=>{
   const r=await original(ss);
   if(stopAfterClaim&&db.raw.prepare("SELECT COUNT(*) n FROM automation_runs WHERE state='running'").get().n){stopAfterClaim=false;await act(db,'stop');}
   return r;
  };
  await assert.rejects(tick(db,'collect','12:00'),/停止・期限切れ/);
  const s=await snapshot(db);assert.equal(s.control.state,'stopped');assert.equal(s.items.length,0);assert.equal(s.runs[0].state,'interrupted');
  await act(db,'start');await assert.rejects(tick(db,'collect','12:00'),/実行済み/);
 }finally{db.raw.close();}
});
test('failed completion rolls back all items; explicit expiry recovery stops and fences run',async()=>{
 const db=dbAt();try{
  await untilDraft(db);const original=db.batch.bind(db);let failed=false;
  db.batch=async ss=>{
   if(!failed&&ss.length>=4){failed=true;return original([...ss,db.prepare('INSERT INTO missing_table VALUES(1)')]);}
   return original(ss);
  };
  await assert.rejects(tick(db,'save','18:00'),/保存に失敗/);
  assert.equal((await snapshot(db)).items.filter(i=>i.kind==='saved_drafts').length,0);
  const s=await snapshot(db);assert.ok(s.control.lease_run_id);
  await assert.rejects(act(db,'recover'),/期限切れ/);
  await act(db,'recover',{}, {now:s.control.lease_until+1});
  const recovered=await snapshot(db);assert.equal(recovered.control.state,'stopped');assert.equal(recovered.control.lease_run_id,null);
  assert.equal(recovered.runs.find(r=>r.step==='save').state,'interrupted');
 }finally{db.raw.close();}
});
test('report works without successful upstream steps; GET is truly read-only',async()=>{
 const db=dbAt();try{
  const before=db.raw.prepare('SELECT total_changes() n').get().n;
  await snapshot(db);assert.equal(db.raw.prepare('SELECT total_changes() n').get().n,before);
  await act(db,'start');await tick(db,'report','19:30');
  const r=(await snapshot(db)).items[0].payload;assert.equal(r.savedDrafts,0);assert.equal(r.steps[0].state,'not_run');
 }finally{db.raw.close();}
});
test('server lease expiry rejects results and non-AI report remains available at exhausted budget',async()=>{
 const db=dbAt();try{
  await act(db,'start');
  await assert.rejects(act(db,'tick',{step:'collect',at:at('12:00')},{now:Date.now()-40000}),/期限切れ/);
  assert.equal((await snapshot(db)).items.length,0);
  await act(db,'recover');await act(db,'start');
  await tick(db,'collect','12:00','2026-11-15');await approve(db,'sources');
  // Simulate an exhausted mock month without touching any real AI ledger.
  db.raw.prepare("UPDATE automation_runs SET reserved_micro=1000000 WHERE state='interrupted'").run();
  await assert.rejects(tick(db,'themes','14:00','2026-11-15'),/予算上限/);
  await act(db,'tick',{step:'report',at:at('19:30','2026-11-15')},{budgetUSD:'0'});
  assert.ok((await snapshot(db)).items.some(i=>i.kind==='daily_report'));
 }finally{db.raw.close();}
});
function dump(db){return ['automation_control','automation_runs','automation_work_items','automation_events'].map(name=>db.raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all());}
test('acceptance before deadline commits ALL results even if later SQLite steps cross deadline',async()=>{
 const db=dbAt();try{
  await act(db,'start');let clocks=0;
  db.raw.function('julianday',(_value)=>{clocks++;return (Date.now()+(clocks===1?0:60000))/86400000+2440587.5;});
  assert.equal((await tick(db,'collect','12:00')).state,'completed');
  const s=await snapshot(db);assert.equal(clocks,1);assert.equal(s.items.length,1);assert.equal(s.runs[0].state,'completed');assert.equal(s.control.lease_run_id,null);assert.ok(s.events.some(e=>e.kind==='completed'));
 }finally{db.raw.close();}
});
test('expiry at D1 acceptance leaves the whole completion transaction unchanged',async()=>{
 const db=dbAt();try{
  await act(db,'start');let before;const batch=db.batch.bind(db);let n=0;
  db.batch=async ss=>{if(++n===2){before=dump(db);db.raw.function('julianday',(_v)=>(Date.now()+60000)/86400000+2440587.5);}return batch(ss);};
  await assert.rejects(tick(db,'collect','12:00'),/停止・期限切れ・競合/);
  assert.deepEqual(dump(db),before);
 }finally{db.raw.close();}
});
for(const skipped of [1,2,3])test(`SQL assertion rolls back acceptance + every result if statement ${skipped} silently affects zero rows`,async()=>{
 const db=dbAt();try{
  await act(db,'start');let before;const batch=db.batch.bind(db);let n=0;
  db.batch=async ss=>{if(++n===2){before=dump(db);ss[skipped]={_run:()=>({meta:{changes:0}})};}return batch(ss);};
  await assert.rejects(tick(db,'collect','12:00'),/保存に失敗/);
  assert.deepEqual(dump(db),before); // Includes accepted run, item, event and lease.
 }finally{db.raw.close();}
});
for(const fence of ['stop','epoch','token','version'])test(`completion rejected without side effects when ${fence} changes before its transaction`,async()=>{
 const db=dbAt();try{
  await act(db,'start');let before;const batch=db.batch.bind(db);let n=0;
  db.batch=async ss=>{
   if(++n===2){
    if(fence==='stop'){db.batch=batch;await act(db,'stop');}
    if(fence==='epoch')db.raw.exec('UPDATE automation_runs SET epoch=epoch+1');
    if(fence==='token')db.raw.exec("UPDATE automation_runs SET write_token='other-owner'");
    if(fence==='version')db.raw.exec('UPDATE automation_control SET version=version+1');
    before=dump(db);
   }
   return batch(ss);
  };
  await assert.rejects(tick(db,'collect','12:00'),/停止・期限切れ・競合/);
  assert.deepEqual(dump(db),before);
 }finally{db.raw.close();}
});
test('unique conflict rolls back result acceptance and preserves pre-existing work data',async()=>{
 const db=dbAt();try{
  await act(db,'start');let before;const batch=db.batch.bind(db);let n=0;
  db.batch=async ss=>{
   if(++n===2){
    db.raw.exec("INSERT INTO automation_work_items VALUES('preview-mock-2026-11-14-sources','preview-mock','2026-11-14','sources',1,'protected','{}','prior','prior',0,0)");before=dump(db);
   }
   return batch(ss);
  };
  await assert.rejects(tick(db,'collect','12:00'),/保存に失敗/);assert.deepEqual(dump(db),before);
 }finally{db.raw.close();}
});
test('stop serialized AFTER complete transaction preserves full results and blocks subsequent steps',async()=>{
 const db=dbAt();try{
  await act(db,'start');const batch=db.batch.bind(db);let n=0;
  db.batch=async ss=>{const r=await batch(ss);if(++n===2){db.batch=batch;await act(db,'stop');}return r;};
  assert.equal((await tick(db,'collect','12:00')).state,'completed');
  const s=await snapshot(db);assert.equal(s.control.state,'stopped');assert.equal(s.runs[0].state,'completed');assert.equal(s.items.length,1);assert.ok(s.events.some(e=>e.kind==='completed'));
  await assert.rejects(tick(db,'themes','14:00'),/停止中/);
 }finally{db.raw.close();}
});
function env(db,extra={}){return {JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'local-test-password',CF_PAGES_BRANCH:'feature/ai-business-rebuild',CF_PAGES_URL:'https://e931cfbb.asset-simulator-87y.pages.dev',AI_MONTHLY_BUDGET_USD:'1',PREVIEW_MOCK_AUTOMATION_ENABLED:'true',...extra};}
const request=(body,password='local-test-password',headers={})=>new Request('https://e931cfbb.asset-simulator-87y.pages.dev/api/business/automation',{method:body?'POST':'GET',headers:{'x-jarvis-password':password,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
test('API denies production, disabled feature, bad credentials, cross origin and over-budget before touching DB',async()=>{
 let touches=0;const db={prepare(){touches++;throw Error('forbidden');}};
 for(const patch of [{CF_PAGES_BRANCH:'main'},{CF_PAGES_BRANCH:undefined},{PREVIEW_MOCK_AUTOMATION_ENABLED:undefined},{CF_PAGES_URL:'https://asset-simulator-87y.pages.dev'},{AI_MONTHLY_BUDGET_USD:'2'},{AI_MONTHLY_BUDGET_USD:undefined}]){
  const e=env(db,patch);assert.equal((await onRequestGet({env:e,request:request()})).status,503);
  assert.equal((await onRequestPost({env:e,request:request({action:'start',expectedVersion:0})})).status,503);
 }
 assert.equal((await onRequestGet({env:env(db),request:request(null,'wrong')})).status,401);
 assert.equal((await onRequestPost({env:env(db),request:request({action:'start',expectedVersion:0},'local-test-password',{Origin:'https://evil.invalid'})})).status,403);
 assert.equal(touches,0);
});
test('authenticated API and read-only missing-schema behavior; no external clients in module graph',async()=>{
 const db=dbAt();try{
  let calls=0;const prior=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('network forbidden');};
  try{
   const e=env(db);const read=await onRequestGet({env:e,request:request()});assert.equal(read.status,200);
   const start=await onRequestPost({env:e,request:request({action:'start',expectedVersion:0})});assert.equal(start.status,200);
   await tick(db,'collect','12:00');await approve(db,'sources');await tick(db,'themes','14:00');await approve(db,'theme');await tick(db,'content','16:00');await tick(db,'save','18:00');await tick(db,'report','19:30');
   assert.equal(calls,0);
  }finally{globalThis.fetch=prior;}
  for(const path of ['lib/preview-mock.js','lib/mock-business-plan.js','lib/ai-money.js','functions/api/business/automation.js']){
   const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
   assert.doesNotMatch(source,/\bfetch\s*\(|\bimport\s*\(|https:\/\/api\.|research-network|ai-runtime|runAI/);
   for(const match of source.matchAll(/from ['"]([^'"]+)['"]/g))assert.ok(['./mock-business-plan.js','./ai-money.js','../../../lib/preview-mock.js','../../../lib/ai-money.js'].includes(match[1]));
  }
  const empty=adaptDB(new DatabaseSync(':memory:'));
  try{assert.equal((await onRequestGet({env:env(empty),request:request()})).status,503);assert.equal(empty.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,0);}finally{empty.raw.close();}
 }finally{db.raw.close();}
});
